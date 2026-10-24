-- Persist receipt intent with payment; SMTP remains outside the transaction.
-- Legacy application workers must not turn a PDF receipt into a plain notice.
CREATE FUNCTION app_private.claim_receipt_aware_email_delivery(p_limit integer,p_include_receipts boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_rows jsonb; v_recovered integer; v_review integer; BEGIN
 PERFORM app_private.require_email_delivery_service();
 -- Legacy or KYC-monitor-reset sending rows retain conservative ambiguity.
 UPDATE public.email_outbox SET status='failed',delivery_state='unknown',
   last_error='email_delivery_unknown',updated_at=now()
 WHERE (p_include_receipts OR (payload->>'receiptOrderId' IS NULL AND NOT (payload ? 'guestAccessToken' AND coalesce(payload->>'reason','')='')))
   AND status<>'sent' AND delivery_state IN ('ready','in_flight')
   AND ((lease_token IS NOT NULL AND lease_expires_at<=now() AND delivery_started_at IS NOT NULL)
     OR (status='sending' AND lease_token IS NULL AND updated_at<now()-interval '15 minutes')
     OR (status='failed' AND lease_token IS NULL AND attempts>0));
 UPDATE public.email_outbox SET status='failed',delivery_state='ready',
   last_error='email_claim_interrupted',next_attempt_at=now(),updated_at=now(),lease_expires_at=NULL,
   lease_token=gen_random_uuid()
 WHERE (p_include_receipts OR (payload->>'receiptOrderId' IS NULL AND NOT (payload ? 'guestAccessToken' AND coalesce(payload->>'reason','')='')))
   AND status<>'sent' AND delivery_state='ready' AND delivery_started_at IS NULL
   AND lease_token IS NOT NULL AND lease_expires_at<=now();
 GET DIAGNOSTICS v_recovered=ROW_COUNT;
 WITH candidates AS (
  SELECT id FROM public.email_outbox WHERE status IN ('pending','failed') AND delivery_state='ready'
    AND attempts<5 AND next_attempt_at<=now()
    AND (p_include_receipts OR (payload->>'receiptOrderId' IS NULL AND NOT (payload ? 'guestAccessToken' AND coalesce(payload->>'reason','')='')))
  ORDER BY created_at LIMIT greatest(1,least(coalesce(p_limit,20),100)) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE public.email_outbox e SET status='sending',attempts=e.attempts+1,lease_token=gen_random_uuid(),
    lease_expires_at=now()+interval '15 minutes',delivery_started_at=NULL,
    smtp_message_id='<outbox-'||e.id::text||'@mylawatan.my>',updated_at=now()
  FROM candidates c WHERE e.id=c.id RETURNING e.*
 ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_rows FROM claimed;
 SELECT count(*) INTO v_review FROM public.email_outbox WHERE (p_include_receipts OR (payload->>'receiptOrderId' IS NULL AND NOT (payload ? 'guestAccessToken' AND coalesce(payload->>'reason','')=''))) AND status<>'sent'
   AND (delivery_state='unknown' OR (status='failed' AND attempts>=5));
 RETURN jsonb_build_object('rows',v_rows,'recovered',v_recovered,'reviewRequired',v_review);
END; $$;


REVOKE ALL ON FUNCTION app_private.claim_receipt_aware_email_delivery(integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.claim_email_outbox_delivery(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT app_private.claim_receipt_aware_email_delivery(p_limit,false);
$$;
CREATE FUNCTION public.claim_email_outbox_delivery_v2(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT app_private.claim_receipt_aware_email_delivery(p_limit,true);
$$;
REVOKE ALL ON FUNCTION public.claim_email_outbox_delivery(integer),public.claim_email_outbox_delivery_v2(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox_delivery(integer),public.claim_email_outbox_delivery_v2(integer) TO service_role;

-- Preserve Guest access credentials and notification semantics; only confirmation
-- or an explicit receipt request receives the trusted receipt marker.
DO $migration$
DECLARE definition text; marker text := 'jsonb_build_object(''recipientName'',v_order.contact_name';
BEGIN
  SELECT pg_get_functiondef('public.queue_guest_order_access(uuid,text,text)'::regprocedure) INTO definition;
  IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'guest_receipt_source_preflight_required'; END IF;
  definition := replace(definition,marker,
    'jsonb_build_object(''locale'',v_order.contact_locale,''receiptOrderId'',CASE WHEN p_reason IS NULL OR p_event_key LIKE ''guest-receipt:%'' THEN v_order.id ELSE NULL END,''recipientName'',v_order.contact_name');
  EXECUTE definition;
END;
$migration$;

CREATE FUNCTION app_private.queue_order_receipt(p_order_id uuid,p_request_hour bigint DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders%ROWTYPE; recipient text; recipient_name text; locale text; mail_key text;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR o.status NOT IN ('paid','completed') THEN RETURN false; END IF;
  IF p_request_hour IS NOT NULL AND p_request_hour <> floor(extract(epoch FROM now())/3600)::bigint THEN RETURN false; END IF;
  IF o.user_id IS NULL THEN
    IF o.guest_subject_id IS NULL THEN RETURN false; END IF;
    mail_key := CASE WHEN p_request_hour IS NULL THEN 'guest-order-confirmation:'||o.id ELSE 'guest-receipt:'||o.id||':'||p_request_hour END;
    PERFORM public.queue_guest_order_access(o.id,mail_key,NULL);
    RETURN EXISTS(SELECT 1 FROM public.email_outbox WHERE event_key=mail_key);
  END IF;
  SELECT coalesce(nullif(btrim(o.contact_email),''),nullif(btrim(u.email),'')),
    coalesce(nullif(o.contact_name,''),u.full_name),coalesce(nullif(o.contact_locale,''),u.preferred_locale,'en')
  INTO recipient,recipient_name,locale FROM public.users u WHERE u.id=o.user_id;
  -- Do not introduce a new purchase eligibility rule for legacy missing contacts.
  IF recipient IS NULL THEN RETURN false; END IF;
  mail_key := CASE WHEN p_request_hour IS NULL THEN 'order-receipt:'||o.id ELSE 'order-receipt-request:'||o.id||':'||p_request_hour END;
  INSERT INTO public.email_outbox(event_key,user_id,to_email,event_type,payload,status,next_attempt_at)
  VALUES(mail_key,o.user_id,recipient,'checkout_succeeded',
    jsonb_build_object('receiptOrderId',o.id,'reference',o.id,'locale',locale,
      'recipientName',recipient_name,'amountRm',o.total_amount,'occurredAt',coalesce(o.paid_at,now())),
    'pending',now()) ON CONFLICT(event_key) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION app_private.queue_order_receipt(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.queue_order_receipt(p_order_id uuid,p_request_hour bigint DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM app_private.require_email_delivery_service();
  RETURN app_private.queue_order_receipt(p_order_id,p_request_hour);
END;
$$;
REVOKE ALL ON FUNCTION public.queue_order_receipt(uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_order_receipt(uuid,bigint) TO service_role;

CREATE FUNCTION app_private.queue_registered_order_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.status IN ('paid','completed')
    AND (TG_OP='INSERT' OR OLD.status NOT IN ('paid','completed')) THEN
    PERFORM app_private.queue_order_receipt(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.queue_registered_order_receipt() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER registered_order_receipt AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION app_private.queue_registered_order_receipt();
NOTIFY pgrst,'reload schema';
