-- Received money and normally fulfilable orders are distinct facts.
CREATE TABLE public.event_order_exceptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_key text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('payment_unfulfillable','refund_attention')),
 order_id uuid NOT NULL REFERENCES public.orders(id),
 checkout_session_id uuid REFERENCES public.checkout_sessions(id),
 payment_id uuid REFERENCES public.payments(id),
 payment_event_id uuid REFERENCES public.payment_events(id),
 verified_amount_sen bigint CHECK(verified_amount_sen>0),verified_currency text CHECK(verified_currency='MYR'),
 refund_id uuid REFERENCES public.refunds(id),
 reason_code text NOT NULL,
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
 assigned_to uuid REFERENCES public.users(id),due_at timestamptz,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz,resolution_note text
);
CREATE UNIQUE INDEX event_exception_payment_receipt_unique ON public.event_order_exceptions(payment_id) WHERE kind='payment_unfulfillable';
ALTER TABLE public.event_order_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_order_exceptions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.event_order_exceptions TO service_role;
ALTER TABLE public.refunds ADD COLUMN refund_scope text NOT NULL DEFAULT 'full_order'
 CHECK(refund_scope IN ('full_order','event_payment_compensation'));
CREATE UNIQUE INDEX event_compensation_unique ON public.refunds(payment_id) WHERE refund_scope='event_payment_compensation';

CREATE FUNCTION app_private.lock_event_checkout(p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record; BEGIN
 FOR c IN SELECT DISTINCT l.campaign_id FROM public.checkout_sessions s JOIN public.order_items oi ON oi.order_id=s.order_id
 JOIN public.promotion_campaign_locations l ON l.id=oi.event_location_id WHERE s.id=p_session ORDER BY l.campaign_id
 LOOP PERFORM app_private.lock_event_campaign(c.campaign_id); END LOOP;
 PERFORM p.id FROM public.promotion_campaign_pickup_slots p JOIN public.checkout_reservations r ON r.pickup_slot_id=p.id
 WHERE r.checkout_session_id=p_session ORDER BY p.id FOR UPDATE OF p;
 PERFORM p.id FROM public.promotion_campaign_vendor_products p JOIN public.checkout_reservations r ON r.event_listing_id=p.id
 WHERE r.checkout_session_id=p_session ORDER BY p.id FOR UPDATE OF p;
END; $$;
REVOKE ALL ON FUNCTION app_private.lock_event_checkout(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.event_checkout_failure(p_session uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.checkout_sessions%ROWTYPE; row record; n integer:=0; BEGIN
 SELECT * INTO s FROM public.checkout_sessions WHERE id=p_session;
 IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=s.order_id AND event_location_id IS NOT NULL) THEN RETURN NULL; END IF;
 IF s.status='paid' THEN RETURN NULL; END IF;
 IF s.status NOT IN ('pending_payment','requires_action') OR s.expires_at<=now() THEN RETURN 'event_hold_expired'; END IF;
 FOR row IN SELECT cr.*,sl.slot_date,sl.starts_at,sl.ends_at,sl.capacity,vp.active,vp.daily_quantity,
 reg.status registration_status,reg.event_location_id,loc.status location_status,loc.starts_on,loc.ends_on,loc.opens_at,loc.closes_at,
 c.status campaign_status,c.ends_at campaign_ends_at,v.status vendor_status
 FROM public.checkout_reservations cr
 JOIN public.promotion_campaign_pickup_slots sl ON sl.id=cr.pickup_slot_id
 JOIN public.promotion_campaign_vendor_products vp ON vp.id=cr.event_listing_id AND vp.registration_id=sl.registration_id
 JOIN public.promotion_campaign_vendors reg ON reg.id=vp.registration_id
 JOIN public.promotion_campaign_locations loc ON loc.id=reg.event_location_id
 JOIN public.promotion_campaigns c ON c.id=reg.campaign_id JOIN public.vendors v ON v.id=reg.vendor_id
 WHERE cr.checkout_session_id=s.id AND cr.kind='event'
 LOOP
 n:=n+1;
 IF row.status<>'held' OR NOT row.active OR row.registration_status<>'approved' OR row.location_status<>'active'
 OR row.campaign_status<>'approved' OR row.campaign_ends_at<=now() OR row.vendor_status<>'approved'
 OR row.pickup_date NOT BETWEEN row.starts_on AND row.ends_on
 OR (row.slot_date IS NOT NULL AND row.slot_date<>row.pickup_date)
 OR row.starts_at<row.opens_at OR row.ends_at>row.closes_at
 OR (row.pickup_date+row.ends_at) AT TIME ZONE 'Asia/Kuala_Lumpur'<=now()
 THEN RETURN 'event_commitment_unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=s.order_id
 AND oi.event_listing_id=row.event_listing_id AND oi.pickup_slot_id=row.pickup_slot_id AND oi.pickup_date=row.pickup_date
 AND oi.quantity=row.quantity AND oi.event_location_id=row.event_location_id
 AND oi.slot_starts_at=(row.pickup_date+row.starts_at) AT TIME ZONE 'Asia/Kuala_Lumpur'
 AND substring(oi.variant_name from '–([0-9]{2}:[0-9]{2})$')=to_char(row.ends_at,'HH24:MI')
 AND oi.fulfil_status IN ('pending','ready')) THEN RETURN 'event_commitment_changed'; END IF;
 IF public.event_units_taken(row.event_listing_id,NULL,row.pickup_date)>row.daily_quantity
 OR public.event_units_taken(NULL,row.pickup_slot_id,row.pickup_date)>row.capacity THEN RETURN 'event_capacity_unavailable'; END IF;
 END LOOP;
 IF n=0 OR n<>(SELECT count(*) FROM public.order_items WHERE order_id=s.order_id AND event_location_id IS NOT NULL) THEN RETURN 'event_hold_missing'; END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app_private.event_checkout_failure(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- This branch is called only after the installed settlement verifies provider,
-- exact receipt/hash, amount, currency and ownership-bound provider reference.
CREATE FUNCTION app_private.record_event_payment_exception(p_session uuid,p_payment uuid,p_provider text,p_event text,p_hash text,p_amount bigint,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.checkout_sessions%ROWTYPE; e uuid; case_id uuid; refund uuid; auto boolean; receipt public.payment_events%ROWTYPE; BEGIN
 SELECT * INTO s FROM public.checkout_sessions WHERE id=p_session FOR UPDATE;
 INSERT INTO public.payment_events(provider,provider_event_id,checkout_session_id,order_id,event_type,payload_hash)
 VALUES(p_provider,p_event,s.id,s.order_id,'payment.succeeded',p_hash)
 ON CONFLICT(provider,provider_event_id) DO NOTHING;
 SELECT * INTO receipt FROM public.payment_events WHERE provider=p_provider AND provider_event_id=p_event;
 IF receipt.checkout_session_id IS DISTINCT FROM s.id OR receipt.order_id IS DISTINCT FROM s.order_id OR receipt.payload_hash IS DISTINCT FROM p_hash OR receipt.event_type<>'payment.succeeded' THEN RAISE EXCEPTION 'provider_event_conflict'; END IF;
 e:=receipt.id;
 -- Close pending holds through the canonical finalizer; split release triggers
 -- stay intact. A cancelled payment is never promoted to the normal paid path.
 IF s.status IN ('pending_payment','requires_action') THEN PERFORM public.finalize_checkout(s.id,'expired'); END IF;
 INSERT INTO public.event_order_exceptions(source_key,kind,order_id,checkout_session_id,payment_id,payment_event_id,verified_amount_sen,verified_currency,reason_code)
 VALUES('event-payment:'||p_payment,'payment_unfulfillable',s.order_id,s.id,p_payment,e,p_amount,'MYR',p_reason)
 ON CONFLICT DO NOTHING;
 SELECT id INTO case_id FROM public.event_order_exceptions WHERE payment_id=p_payment AND kind='payment_unfulfillable';
 SELECT now()<c.starts_at AND p_provider IN ('stripe','tng_ewallet_simulator','grabpay_simulator','bank_transfer_simulator') INTO auto
 FROM public.order_items oi JOIN public.promotion_campaign_locations l ON l.id=oi.event_location_id
 JOIN public.promotion_campaigns c ON c.id=l.campaign_id WHERE oi.order_id=s.order_id LIMIT 1;
 -- External receipt is the only new money in this branch. Reserved wallet
 -- funds have been released; committed/ambiguous wallet evidence fails closed.
 IF NOT EXISTS(SELECT 1 FROM public.checkout_wallet_reservations WHERE checkout_session_id=s.id AND status IN ('reserved','committed')) THEN
 INSERT INTO public.refunds(payment_id,order_id,amount,reason,status,auto_process,refund_scope)
 VALUES(p_payment,s.order_id,p_amount/100.0,'Unfulfillable event payment: '||p_reason,'pending',coalesce(auto,false),'event_payment_compensation')
 ON CONFLICT DO NOTHING RETURNING id INTO refund;
 IF refund IS NULL THEN SELECT id INTO refund FROM public.refunds WHERE payment_id=p_payment AND refund_scope='event_payment_compensation'; END IF;
 UPDATE public.event_order_exceptions SET refund_id=refund WHERE id=case_id;
 ELSE
 UPDATE public.event_order_exceptions SET reason_code='funding_requires_review' WHERE id=case_id;
 END IF;
 RETURN jsonb_build_object('checkout_session_id',s.id,'order_id',s.order_id,'status','payment_exception','idempotent',false);
END; $$;
REVOKE ALL ON FUNCTION app_private.record_event_payment_exception(uuid,uuid,text,text,text,bigint,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.valid_event_compensation(p_refund uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.refunds r JOIN public.event_order_exceptions c ON c.refund_id=r.id AND c.kind='payment_unfulfillable'
 JOIN public.payment_events e ON e.id=c.payment_event_id JOIN public.payments p ON p.id=c.payment_id
 JOIN public.checkout_sessions s ON s.id=c.checkout_session_id JOIN public.orders o ON o.id=c.order_id
 WHERE r.id=p_refund AND r.refund_scope='event_payment_compensation' AND r.payment_id=p.id AND r.order_id=o.id
 AND e.order_id=o.id AND e.checkout_session_id=s.id AND s.order_id=o.id AND e.provider=p.provider
 AND e.event_type='payment.succeeded' AND e.payload_hash ~ '^[0-9a-f]{64}$'
 AND lower(o.status) IN ('cancelled','refunded') AND s.status IN ('expired','failed','cancelled')
 AND round(r.amount*100)=c.verified_amount_sen AND c.verified_currency='MYR' AND r.amount=p.amount AND p.amount>0 AND r.wallet_topup_sen=0 AND r.wallet_earnings_sen=0
 AND NOT EXISTS(SELECT 1 FROM public.checkout_wallet_reservations wr WHERE wr.checkout_session_id=s.id AND wr.status IN ('reserved','committed')))
$$;
REVOKE ALL ON FUNCTION app_private.valid_event_compensation(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$ DECLARE f record; src text; changed text; count_final integer:=0; count_settle integer:=0; BEGIN
 FOR f IN SELECT p.oid,p.proname,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('public','app_private') AND l.lanname='plpgsql'
 AND p.proname IN ('finalize_checkout','settle_provider_checkout','finalize_customer_wallet_checkout','expire_checkout_sessions','snapshot_order_refund_funding','process_wallet_refund','record_order_refund_provider_outcome','begin_simulated_refund','settle_simulated_refund','cancel_event_reservations')
 LOOP
 src:=replace(pg_get_functiondef(f.oid),E'\r',''); changed:=src;
 IF f.proname IN ('finalize_checkout','settle_provider_checkout','finalize_customer_wallet_checkout') THEN
  IF position('checkout_not_owned' IN src)=0 AND f.proname<>'settle_provider_checkout' THEN RAISE EXCEPTION 'checkout_owner_preflight_required'; END IF;
  changed:=regexp_replace(src,E'\nBEGIN\n',E'\nBEGIN\n PERFORM app_private.lock_event_checkout(p_checkout_session_id);\n');
 END IF;
 IF f.proname='finalize_checkout' THEN
  IF position('inventory_commit_failed' IN src)=0 OR position('wallet_insufficient' IN src)=0 THEN RAISE EXCEPTION 'finalizer_preflight_required'; END IF;
  -- Wallet/client success fails before any money is debited. Provider exceptions
  -- are handled by verified settlement before invoking this success branch.
  changed:=replace(changed,'  IF v_session.status = ''paid'' THEN',E'  IF lower(p_outcome)=''succeeded'' AND v_session.status<>''paid'' AND app_private.event_checkout_failure(v_session.id) IS NOT NULL THEN RAISE EXCEPTION ''event_commitment_unavailable''; END IF;\n  IF v_session.status = ''paid'' THEN');
  count_final:=count_final+1;
 ELSIF f.proname='settle_provider_checkout' THEN
  IF position('provider_amount_mismatch' IN src)=0 OR position('provider_event_conflict' IN src)=0 OR position('provider_payment_id_mismatch' IN src)=0 THEN RAISE EXCEPTION 'provider_preflight_required'; END IF;
  changed:=replace(changed,'''status'', v_session.status,', '''status'', CASE WHEN EXISTS(SELECT 1 FROM public.event_order_exceptions WHERE checkout_session_id=v_session.id AND kind=''payment_unfulfillable'') THEN ''payment_exception'' ELSE v_session.status END,');
  changed:=replace(changed,'  IF v_session.status IN (''paid'', ''failed'', ''cancelled'', ''expired'')'||E'\n     AND v_session.status <> v_target_status THEN',
  E'  IF lower(p_outcome)=''succeeded'' AND app_private.event_checkout_failure(v_session.id) IS NOT NULL THEN\n    RETURN app_private.record_event_payment_exception(v_session.id,v_payment.id,p_provider,p_provider_event_id,p_payload_sha256,p_amount_sen,app_private.event_checkout_failure(v_session.id));\n  END IF;\n  IF v_session.status IN (''paid'', ''failed'', ''cancelled'', ''expired'')\n     AND v_session.status <> v_target_status THEN');
  IF position('RETURN app_private.record_event_payment_exception' IN changed)=0 THEN RAISE EXCEPTION 'provider_patch_failed'; END IF;
  count_settle:=count_settle+1;
 ELSIF f.proname='expire_checkout_sessions' THEN
  changed:=replace(changed,'AND expires_at < NOW() FOR UPDATE LOOP','AND expires_at < NOW() ORDER BY id LOOP');
 ELSIF f.proname='cancel_event_reservations' THEN
  changed:=regexp_replace(src,E'\nBEGIN\n',E'\nBEGIN\n PERFORM app_private.cancel_pending_event_checkouts(p_campaign_id,p_location_id,p_registration_id);\n');
 ELSIF f.proname='snapshot_order_refund_funding' THEN
  IF position('refund_funding_ledger_mismatch' IN src)=0 THEN RAISE EXCEPTION 'funding_preflight_required'; END IF;
  changed:=replace(src,'  SELECT * INTO v_order FROM public.orders',E'  IF v_refund.refund_scope=''event_payment_compensation'' THEN\n    IF NOT app_private.valid_event_compensation(v_refund.id) THEN RAISE EXCEPTION ''compensation_evidence_invalid''; END IF;\n    UPDATE public.refunds SET external_amount_sen=round(amount*100),wallet_topup_sen=0,wallet_earnings_sen=0,funding_snapshot_at=now() WHERE id=v_refund.id;\n    RETURN jsonb_build_object(''refund_id'',v_refund.id,''external_amount_sen'',round(v_refund.amount*100));\n  END IF;\n  SELECT * INTO v_order FROM public.orders');
 ELSE
  -- Only the receipt-bound compensation scope can use a cancelled payment.
  changed:=replace(changed,'v_payment.status <> ''succeeded''', '(v_payment.status <> ''succeeded'' AND NOT app_private.valid_event_compensation(v_refund.id))');
  changed:=replace(changed,'v_payment.status<>''succeeded''', '(v_payment.status<>''succeeded'' AND NOT app_private.valid_event_compensation(v_refund.id))');
  IF f.proname='process_wallet_refund' AND position('v_total := ROUND(v_order.total_amount' IN src)>0 THEN
    changed:=replace(changed,'v_total := ROUND(v_order.total_amount * 100)::BIGINT;', 'v_total := CASE WHEN app_private.valid_event_compensation(v_refund.id) THEN ROUND(v_refund.amount*100)::BIGINT ELSE ROUND(v_order.total_amount*100)::BIGINT END;');
  END IF;
 END IF;
 IF changed<>src THEN EXECUTE changed; END IF;
 END LOOP;
 IF count_final<>1 OR count_settle<>1 THEN RAISE EXCEPTION 'checkout_installation_preflight_required'; END IF;
END; $patch$;

CREATE FUNCTION app_private.cancel_pending_event_checkouts(p_campaign uuid,p_location uuid,p_registration uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s record; n integer:=0; BEGIN
 FOR s IN SELECT DISTINCT cs.id FROM public.checkout_sessions cs JOIN public.order_items oi ON oi.order_id=cs.order_id
 JOIN public.promotion_campaign_locations l ON l.id=oi.event_location_id
 JOIN public.promotion_campaign_vendor_products vp ON vp.id=oi.event_listing_id
 WHERE cs.status IN ('pending_payment','requires_action') AND
 ((p_campaign IS NOT NULL AND l.campaign_id=p_campaign) OR (p_location IS NOT NULL AND l.id=p_location) OR (p_registration IS NOT NULL AND vp.registration_id=p_registration)) ORDER BY cs.id
 LOOP PERFORM public.finalize_checkout(s.id,'cancelled'); n:=n+1; END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION app_private.cancel_pending_event_checkouts(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
-- A retry must take the campaign lock before an existing session lock too.
DO $patch$ DECLARE f record; src text; changed text; BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN ('public','app_private') AND l.lanname='plpgsql' AND p.proname IN ('event_checkout_transaction_core','prepare_event_checkout') LOOP
 src:=replace(pg_get_functiondef(f.oid),E'\r','');
 IF position('-- Lock order: slot, then listing' IN src)=0 THEN CONTINUE; END IF;
 changed:=regexp_replace(src,E'\nBEGIN\n',E'\nBEGIN\n PERFORM app_private.lock_event_campaign((SELECT r.campaign_id FROM public.promotion_campaign_vendor_products p JOIN public.promotion_campaign_vendors r ON r.id=p.registration_id WHERE p.id=p_listing_id));\n');
 IF changed=src THEN RAISE EXCEPTION 'checkout_retry_lock_preflight_required'; END IF;
 EXECUTE changed;
 END LOOP;
END; $patch$;
CREATE FUNCTION app_private.guard_event_exception_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF (NEW.source_key,NEW.kind,NEW.order_id,NEW.checkout_session_id,NEW.payment_id,NEW.payment_event_id,NEW.verified_amount_sen,NEW.verified_currency)
 IS DISTINCT FROM (OLD.source_key,OLD.kind,OLD.order_id,OLD.checkout_session_id,OLD.payment_id,OLD.payment_event_id,OLD.verified_amount_sen,OLD.verified_currency) THEN RAISE EXCEPTION 'event_receipt_immutable'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.guard_event_exception_receipt() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_exception_receipt_immutable BEFORE UPDATE ON public.event_order_exceptions FOR EACH ROW EXECUTE FUNCTION app_private.guard_event_exception_receipt();
-- Network initiation can finish after cancellation. Bind its receipt reference
-- durably, but never let a delayed requires_action update reopen the order.
CREATE FUNCTION app_private.guard_terminal_event_checkout() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF OLD.status IN ('failed','expired','cancelled') AND NEW.status IN ('pending_payment','pending','requires_action')
 AND EXISTS(SELECT 1 FROM public.order_items WHERE order_id=NEW.order_id AND event_location_id IS NOT NULL) THEN NEW.status:=OLD.status; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.guard_terminal_event_checkout() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_session_no_reopen BEFORE UPDATE ON public.checkout_sessions FOR EACH ROW EXECUTE FUNCTION app_private.guard_terminal_event_checkout();
CREATE TRIGGER event_payment_no_reopen BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION app_private.guard_terminal_event_checkout();
-- Preserve Guest access-token generation and queue the actual refund amount.
DO $$ DECLARE expression text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_event_type_check';
 IF expression IS NULL THEN RAISE EXCEPTION 'email_outbox_constraint_preflight_required'; END IF;
 ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
 EXECUTE 'ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_event_type_check CHECK (('||expression||') OR event_type=''order_refunded'')';
END $$;
CREATE FUNCTION app_private.queue_guest_refund_confirmation(p_refund uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE r public.refunds%ROWTYPE; o public.orders%ROWTYPE; key text; BEGIN
 SELECT * INTO r FROM public.refunds WHERE id=p_refund AND status='processed';
 SELECT * INTO o FROM public.orders WHERE id=r.order_id;
 IF o.user_id IS NOT NULL OR o.guest_subject_id IS NULL THEN RETURN; END IF;
 key:='guest-order-refund:'||r.id;
 PERFORM public.queue_guest_order_access(o.id,key,'Refund completed using the original funding channels.');
 UPDATE public.email_outbox SET event_type='order_refunded',payload=payload||jsonb_build_object('amountRm',r.amount,'reference',coalesce(o.display_id,'Order refund'))
 WHERE event_key=key AND status='pending';
END; $$;
REVOKE ALL ON FUNCTION app_private.queue_guest_refund_confirmation(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$ DECLARE f record; src text; changed text; n integer:=0; BEGIN
 IF to_regprocedure('public.queue_guest_order_access(uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'guest_refund_notice_preflight_required'; END IF;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','app_private') AND p.proname='process_wallet_refund' LOOP
 src:=replace(pg_get_functiondef(f.oid),E'\r','');
 IF position('INSERT INTO public.notifications(user_id,type,title,body,link)' IN src)=0 THEN CONTINUE; END IF;
 changed:=replace(src,'  INSERT INTO public.notifications(user_id,type,title,body,link)',E'  IF v_order.user_id IS NOT NULL THEN\n  INSERT INTO public.notifications(user_id,type,title,body,link)');
 changed:=replace(changed,'''/customer/wallet'');',E'''/customer/wallet'');\n ELSE PERFORM app_private.queue_guest_refund_confirmation(v_refund.id); END IF;');
 IF changed=src OR position('queue_guest_refund_confirmation(v_refund.id)' IN changed)=0 THEN RAISE EXCEPTION 'guest_refund_notice_patch_failed'; END IF;
 EXECUTE changed;n:=n+1;
 END LOOP;
 IF n<>1 THEN RAISE EXCEPTION 'guest_refund_notice_installation_required'; END IF;
END; $patch$;
