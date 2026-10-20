-- One live unpaid commitment per owner, across ordinary and event Checkout.
-- Use an owner lock, not an idempotency-key lock: different keys must compete.
CREATE FUNCTION app_private.lock_checkout_owner(p_user uuid,p_guest uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF num_nonnulls(p_user,p_guest)<>1 THEN RAISE EXCEPTION 'checkout_not_owned'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('checkout-owner:'||coalesce(p_user,p_guest)::text,0));
END; $$;
REVOKE ALL ON FUNCTION app_private.lock_checkout_owner(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE INDEX checkout_active_user_budget ON public.checkout_sessions(user_id,expires_at,id)
 WHERE status IN ('pending_payment','requires_action') AND user_id IS NOT NULL;
CREATE INDEX checkout_active_guest_budget ON public.checkout_sessions(guest_subject_id,expires_at,id)
 WHERE status IN ('pending_payment','requires_action') AND guest_subject_id IS NOT NULL;

CREATE FUNCTION app_private.reuse_unpaid_checkout(p_user uuid,p_guest uuid,p_hash text,p_total numeric DEFAULT NULL,p_lines jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.checkout_sessions%ROWTYPE; matching boolean; BEGIN
 -- Caller has validated ownership and holds lock_checkout_owner.
 -- Separate equality predicates let PostgreSQL use the owner-specific indexes
 -- instead of scanning everyone else's unpaid sessions with null-safe joins.
 IF p_user IS NOT NULL THEN
  SELECT * INTO s FROM public.checkout_sessions WHERE user_id=p_user AND guest_subject_id IS NULL
   AND status IN ('pending_payment','requires_action') AND expires_at>now() ORDER BY created_at,id LIMIT 1;
 ELSE
  SELECT * INTO s FROM public.checkout_sessions WHERE guest_subject_id=p_guest AND user_id IS NULL
   AND status IN ('pending_payment','requires_action') AND expires_at>now() ORDER BY created_at,id LIMIT 1;
 END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 matching:=s.request_hash IS NOT DISTINCT FROM p_hash;
 IF p_lines IS NOT NULL THEN
  -- Cart request hashes intentionally omit mutable quantities/prices. Compare
  -- authoritative snapshots too before reusing a differently keyed attempt.
  matching:=matching AND s.total_amount IS NOT DISTINCT FROM p_total AND
   (SELECT coalesce(jsonb_agg(x.line ORDER BY x.line::text),'[]'::jsonb) FROM
    (SELECT jsonb_build_array(product_id,variant_id,slot_id,outlet_id,quantity,unit_price,line_total) line
     FROM jsonb_to_recordset(p_lines) AS l(product_id uuid,variant_id uuid,slot_id uuid,outlet_id uuid,quantity integer,unit_price numeric,line_total numeric)) x)
   = (SELECT coalesce(jsonb_agg(x.line ORDER BY x.line::text),'[]'::jsonb) FROM
    (SELECT jsonb_build_array(product_id,variant_id,slot_id,outlet_id,quantity,unit_price,line_total) line FROM public.order_items WHERE order_id=s.order_id) x);
 END IF;
 IF NOT coalesce(matching,false) THEN
  RAISE EXCEPTION 'active_checkout_exists' USING DETAIL=jsonb_build_object('order_id',s.order_id)::text;
 END IF;
 RETURN jsonb_build_object('checkout_session_id',s.id,'order_id',s.order_id,'status',s.status,'total',s.total_amount,'expires_at',s.expires_at);
END; $$;
REVOKE ALL ON FUNCTION app_private.reuse_unpaid_checkout(uuid,uuid,text,numeric,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.checkout_commitment_failure(p_session uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.checkout_sessions%ROWTYPE; BEGIN
 SELECT * INTO s FROM public.checkout_sessions WHERE id=p_session;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_session_not_found'; END IF;
 -- A replay cannot turn an already committed payment into a new exception.
 IF s.status='paid' THEN RETURN NULL; END IF;
 IF s.status NOT IN ('pending_payment','requires_action') OR s.expires_at<=now() THEN RETURN 'checkout_hold_expired'; END IF;
 IF s.user_id IS NOT NULL THEN
  PERFORM 1 FROM public.users WHERE id=s.user_id FOR SHARE;
  IF NOT public.customer_is_active_email_verified(s.user_id)
   OR NOT coalesce((public.resolve_user_capability(s.user_id,'commerce.checkout')->>'allowed')::boolean,false)
  THEN RETURN 'checkout_eligibility_lost'; END IF;
 END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app_private.checkout_commitment_failure(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Forward patches retain installed inventory, wallet, voucher and event guards.
DO $patch$ DECLARE f record; src text; changed text; marker text; budget text; n integer:=0; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 JOIN pg_language l ON l.oid=p.prolang WHERE ns.nspname IN ('public','app_private') AND l.lanname='plpgsql'
 AND p.proname IN ('checkout_transaction_core','event_checkout_transaction_core') LOOP
  src:=replace(pg_get_functiondef(f.oid),E'\r','');
  IF position('PERFORM public.validate_checkout_subject(v_user,p_owner_guest,p_contact);' IN src)=0
   OR position('idempotency_key_reused' IN src)=0 THEN RAISE EXCEPTION 'checkout_budget_source_drift'; END IF;
  changed:=regexp_replace(src,E'\nBEGIN\n',E'\nBEGIN\n PERFORM app_private.lock_checkout_owner(p_owner_user,p_owner_guest);\n');
  changed:=replace(changed,'PERFORM public.validate_checkout_subject(v_user,p_owner_guest,p_contact);',E'PERFORM 1 FROM public.users WHERE id=p_owner_user FOR SHARE;\n  PERFORM public.validate_checkout_subject(v_user,p_owner_guest,p_contact);');
  -- A declaration is needed because JSON must be returned without new holds.
  changed:=replace(changed,E'\nDECLARE\n',E'\nDECLARE\n v_budget jsonb;\n');
  marker:='  IF p_payment_method NOT IN (';
  budget:=CASE WHEN f.proname='checkout_transaction_core'
   THEN '  v_budget:=app_private.reuse_unpaid_checkout(v_user,p_owner_guest,p_request_hash,p_total,p_lines);'
   ELSE '  v_budget:=app_private.reuse_unpaid_checkout(v_user,p_owner_guest,p_request_hash);' END;
  IF position(marker IN changed)=0 THEN RAISE EXCEPTION 'checkout_budget_marker_drift'; END IF;
  changed:=replace(changed,marker,budget||E'\n  IF v_budget IS NOT NULL THEN RETURN v_budget; END IF;\n'||marker);
  IF changed=src OR position('v_budget jsonb' IN changed)=0 THEN RAISE EXCEPTION 'checkout_budget_patch_failed'; END IF;
  EXECUTE changed; n:=n+1;
 END LOOP;
 IF n<>2 THEN RAISE EXCEPTION 'checkout_budget_installation_required'; END IF;
END; $patch$;

-- Acquire the same owner lock before campaign/session locks in finalizers.
DO $patch$ DECLARE f record; src text; changed text; n integer:=0; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 JOIN pg_language l ON l.oid=p.prolang WHERE ns.nspname IN ('public','app_private') AND l.lanname='plpgsql'
 AND p.proname IN ('finalize_checkout','settle_provider_checkout','finalize_customer_wallet_checkout') LOOP
  src:=replace(pg_get_functiondef(f.oid),E'\r','');
  IF position('PERFORM app_private.lock_event_checkout(p_checkout_session_id);' IN src)=0 THEN RAISE EXCEPTION 'checkout_commitment_source_drift'; END IF;
  changed:=replace(src,' PERFORM app_private.lock_event_checkout(p_checkout_session_id);',
   E' PERFORM app_private.lock_checkout_owner(s.user_id,s.guest_subject_id) FROM public.checkout_sessions s WHERE s.id=p_checkout_session_id;\n PERFORM app_private.lock_event_checkout(p_checkout_session_id);');
  IF f.proname='finalize_checkout' THEN
   IF position('  IF v_session.status = ''paid'' THEN' IN changed)=0 THEN RAISE EXCEPTION 'finalizer_eligibility_marker_drift'; END IF;
   changed:=replace(changed,'  IF v_session.status = ''paid'' THEN',
    E'  IF lower(p_outcome)=''succeeded'' AND app_private.checkout_commitment_failure(v_session.id) IS NOT NULL THEN RAISE EXCEPTION ''checkout_commitment_unavailable''; END IF;\n  IF v_session.status = ''paid'' THEN');
  ELSIF f.proname='settle_provider_checkout' THEN
   IF position('RETURN app_private.record_event_payment_exception' IN changed)=0 THEN RAISE EXCEPTION 'provider_receipt_guard_missing'; END IF;
   changed:=replace(changed,'  IF lower(p_outcome)=''succeeded'' AND app_private.event_checkout_failure(v_session.id) IS NOT NULL THEN',
    E'  IF lower(p_outcome)=''succeeded'' AND app_private.checkout_commitment_failure(v_session.id) IS NOT NULL THEN\n    RETURN app_private.record_event_payment_exception(v_session.id,v_payment.id,p_provider,p_provider_event_id,p_payload_sha256,p_amount_sen,app_private.checkout_commitment_failure(v_session.id));\n  END IF;\n  IF lower(p_outcome)=''succeeded'' AND app_private.event_checkout_failure(v_session.id) IS NOT NULL THEN');
  END IF;
  IF changed=src THEN RAISE EXCEPTION 'checkout_commitment_patch_failed'; END IF;
  EXECUTE changed; n:=n+1;
 END LOOP;
 IF n<>3 THEN RAISE EXCEPTION 'checkout_commitment_installation_required'; END IF;
END; $patch$;

-- Reuse immutable receipt, canonical release and manual refund review. Even an
-- event before its start must NOT auto-refund an account eligibility exception.
DO $patch$ DECLARE src text; changed text; BEGIN
 src:=pg_get_functiondef('app_private.record_event_payment_exception(uuid,uuid,text,text,text,bigint,text)'::regprocedure);
 IF position('coalesce(auto,false)' IN src)=0 THEN RAISE EXCEPTION 'manual_exception_source_drift'; END IF;
 changed:=replace(src,'coalesce(auto,false)', 'CASE WHEN p_reason IN (''checkout_eligibility_lost'',''checkout_hold_expired'') THEN false ELSE coalesce(auto,false) END');
 EXECUTE changed;
END; $patch$;

-- Payment creation may finish after explicit cancellation. The existing event
-- terminal guard must protect ordinary Checkout too, or its delayed provider
-- update could reopen a second live Checkout for the same owner.
CREATE OR REPLACE FUNCTION app_private.guard_terminal_event_checkout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF OLD.status IN ('failed','expired','cancelled') AND NEW.status IN ('pending_payment','pending','requires_action') THEN
  NEW.status:=OLD.status;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.guard_terminal_event_checkout() FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
