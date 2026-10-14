-- Forward-only continuation of the existing transactional Vendor notification
-- and Email Outbox boundary. No money, pickup, refund or assignment mutation.
CREATE FUNCTION app_private.queue_event_exception_vendor_notice(p_case uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.event_order_exceptions%ROWTYPE; r public.refunds%ROWTYPE;
 recipient record; phase text; message text; financial boolean; reference text;
 items text; details text; v_key text; category text; kind text;
BEGIN
 SELECT * INTO c FROM public.event_order_exceptions WHERE id=p_case;
 IF NOT FOUND THEN RETURN; END IF;
 IF c.refund_id IS NOT NULL THEN SELECT * INTO r FROM public.refunds WHERE id=c.refund_id; END IF;
 IF r.status='processed' THEN phase:='refunded';
 ELSIF c.state='resolved' THEN
   phase:=CASE c.resolution_code WHEN 'collected' THEN 'collected' WHEN 'customer_no_show' THEN 'no_show' ELSE NULL END;
 ELSIF r.provider_failure_code IS NOT NULL OR r.provider_failure_message IS NOT NULL OR r.status='rejected' THEN phase:='refund_attention';
 ELSIF r.status IN ('pending','approved') THEN phase:='refund_pending';
 ELSE phase:=CASE c.kind WHEN 'payment_unfulfillable' THEN 'payment_blocked' WHEN 'pickup_overdue' THEN 'pickup_review' WHEN 'refund_attention' THEN 'refund_attention' END;
 END IF;
 IF phase IS NULL THEN RETURN; END IF;
 financial:=phase IN ('payment_blocked','refund_pending','refund_attention','refunded');
 message:=CASE phase
   WHEN 'payment_blocked' THEN 'Payment was received but this reservation cannot be fulfilled. Do not prepare or hand over goods. Admin is reviewing the payment.'
   WHEN 'pickup_review' THEN 'The pickup date has passed and collection is unconfirmed. Please verify whether your items were handed over and contact Admin with the actual outcome.'
   WHEN 'refund_pending' THEN 'A refund is under review or awaiting the payment provider. It has not been confirmed complete. Contact Admin before further fulfilment.'
   WHEN 'refund_attention' THEN 'A refund needs Admin attention. Completion has not been confirmed. Contact Admin before further fulfilment.'
   WHEN 'refunded' THEN 'The order refund has been confirmed complete. Review your order and settlement records.'
   WHEN 'collected' THEN 'Collection has been verified and the pickup exception is closed.'
   WHEN 'no_show' THEN 'Admin has verified non-collection and closed this pickup exception without a refund. This does not mean goods were handed over or funds are immediately available.' END;
 SELECT coalesce(nullif(btrim(app_private.event_notice_display_text(display_id)),''),'Event order') INTO reference FROM public.orders WHERE id=c.order_id;
 -- Owners receive one scoped notice even when event lines have no outlet.
 -- Managers receive only their exact operational outlet; financial phases are
 -- owner-only and use the existing vendor_wallet API exclusion.
 FOR recipient IN
   SELECT DISTINCT v.id vendor_id,v.owner_id user_id,NULL::uuid outlet_id,'vendor_owner'::text audience_role,
     u.email,u.full_name,v.name vendor_name
   FROM public.order_items i JOIN public.vendors v ON v.id=i.vendor_id JOIN public.users u ON u.id=v.owner_id
   WHERE i.order_id=c.order_id AND i.event_location_id IS NOT NULL AND v.status='approved' AND u.status='active'
   UNION
   SELECT DISTINCT v.id,m.user_id,o.id,'outlet_manager',u.email,u.full_name,v.name
   FROM public.order_items i JOIN public.vendors v ON v.id=i.vendor_id
   JOIN public.outlets o ON o.id=i.outlet_id AND o.vendor_id=v.id
   JOIN public.outlet_managers m ON m.outlet_id=o.id JOIN public.users u ON u.id=m.user_id
   WHERE i.order_id=c.order_id AND i.event_location_id IS NOT NULL AND v.status='approved' AND u.status='active' AND NOT financial AND m.user_id<>v.owner_id
   ORDER BY vendor_id,user_id,outlet_id NULLS FIRST
 LOOP
   SELECT string_agg(format('%s × %s · %s · %s · %s–%s',i.quantity,
     app_private.event_notice_display_text(i.product_name),app_private.event_notice_display_text(l.name),
     coalesce(i.pickup_date::text,'Date pending'),coalesce(s.starts_at::text,'Time pending'),coalesce(s.ends_at::text,'Time pending')), '; ' ORDER BY i.id)
   INTO items FROM public.order_items i JOIN public.promotion_campaign_locations l ON l.id=i.event_location_id
   LEFT JOIN public.promotion_campaign_pickup_slots s ON s.id=i.pickup_slot_id
   WHERE i.order_id=c.order_id AND i.vendor_id=recipient.vendor_id AND (recipient.outlet_id IS NULL OR i.outlet_id=recipient.outlet_id);
   details:=reference||' · '||coalesce(items,'Review your event order in the Vendor Portal');
   v_key:='vendor_exception:'||c.id||':'||phase||':'||recipient.vendor_id||':'||recipient.user_id||':'||coalesce(recipient.outlet_id::text,'owner');
   category:=CASE WHEN financial THEN 'vendor_wallet' ELSE 'vendor_orders' END;
   kind:=CASE WHEN financial THEN 'vendor_wallet_update' ELSE 'vendor_order_update' END;
   INSERT INTO public.notifications(user_id,vendor_id,outlet_id,audience_role,type,title,body,link,category,metadata,event_key)
   VALUES(recipient.user_id,recipient.vendor_id,recipient.outlet_id,recipient.audience_role,'vendor_event_exception_'||phase,
     'Event order update',message||' '||details,'/vendor/orders',category,
     jsonb_build_object('orderReference',reference,'items',coalesce(items,'')),v_key)
   ON CONFLICT(event_key) DO NOTHING;
   INSERT INTO public.email_outbox(event_key,user_id,to_email,event_type,payload,status,last_error)
   VALUES(v_key,recipient.user_id,coalesce(nullif(btrim(recipient.email),''),''),kind,
     jsonb_build_object('recipientName',app_private.event_notice_display_text(recipient.full_name),
       'vendorName',app_private.event_notice_display_text(recipient.vendor_name),'reason',message||' '||details,
       'reference',reference,'occurredAt',clock_timestamp(),'actionPath','/vendor/orders'),
     CASE WHEN nullif(btrim(recipient.email),'') IS NULL THEN 'failed' ELSE 'pending' END,
     CASE WHEN nullif(btrim(recipient.email),'') IS NULL THEN 'recipient_email_unavailable' ELSE NULL END)
   ON CONFLICT(event_key) DO NOTHING;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app_private.queue_event_exception_vendor_notice(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.notify_event_exception_vendor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Fetch current state in the queue helper, never the historic trigger NEW.
 PERFORM app_private.queue_event_exception_vendor_notice(NEW.id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.notify_event_exception_vendor() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER event_exception_vendor_notice AFTER INSERT OR UPDATE ON public.event_order_exceptions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.notify_event_exception_vendor();

CREATE FUNCTION app_private.notify_event_exception_refund_vendor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; BEGIN
 FOR c IN SELECT id FROM public.event_order_exceptions WHERE refund_id=NEW.id ORDER BY id LOOP
   PERFORM app_private.queue_event_exception_vendor_notice(c.id);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.notify_event_exception_refund_vendor() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER event_exception_refund_vendor_notice AFTER INSERT OR UPDATE ON public.refunds
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.notify_event_exception_refund_vendor();

-- Existing open work needs the same current-state notice. Idempotency protects
-- repeated deployment/refresh; do not broadcast historical resolved cases.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT id FROM public.event_order_exceptions WHERE state='open' ORDER BY id LOOP
   PERFORM app_private.queue_event_exception_vendor_notice(c.id);
 END LOOP;
END $$;
