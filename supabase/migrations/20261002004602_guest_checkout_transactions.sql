-- Extract the installed, fully patched transaction; preserve all catalogue,
-- inventory, free-price, event-capacity and fulfilment validation in one core.
CREATE SCHEMA IF NOT EXISTS app_private;
-- Resolve the installed implementation, retaining existing public invoker RPCs.
CREATE FUNCTION app_private.guest_migration_source(p_signature text)
RETURNS TABLE(source text,arguments text,owner_schema text)
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE target oid; private_target oid;
BEGIN
 target:=to_regprocedure(p_signature);
 private_target:=to_regprocedure(replace(p_signature,'public.','app_private.'));
 IF private_target IS NOT NULL THEN target:=private_target; END IF;
 RETURN QUERY SELECT replace(p.prosrc,E'\r\n',E'\n'),pg_get_function_arguments(p.oid),n.nspname::text
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=target AND l.lanname='plpgsql';
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_implementation_source_missing'; END IF;
END; $$;
REVOKE ALL ON FUNCTION app_private.guest_migration_source(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.validate_checkout_subject(p_user UUID,p_guest UUID,p_contact JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF num_nonnulls(p_user,p_guest)<>1 THEN RAISE EXCEPTION 'checkout_not_owned'; END IF;
 IF p_guest IS NOT NULL THEN
  IF coalesce(auth.role(),'')<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.guest_checkout_subjects WHERE id=p_guest AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'checkout_not_owned'; END IF;
  IF coalesce(p_contact->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN RAISE EXCEPTION 'contact_email_required'; END IF;
 ELSE
  IF p_user IS DISTINCT FROM auth.uid() OR NOT public.customer_is_active_email_verified(p_user) THEN RAISE EXCEPTION 'email_verification_required'; END IF;
  IF NOT coalesce((public.resolve_user_capability(p_user,'commerce.checkout')->>'allowed')::boolean,false) THEN RAISE EXCEPTION 'checkout_capability_denied'; END IF;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.validate_checkout_subject(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE src TEXT; args TEXT; signature TEXT; name TEXT; core TEXT; call_args TEXT; owner_check TEXT; implementation_schema text;
BEGIN
 FOR signature,name,core,call_args IN SELECT * FROM (VALUES
 ('public.prepare_checkout(uuid,uuid[],text,text,text,numeric,numeric,numeric,text,jsonb)','prepare_checkout','checkout_transaction_core','p_cart_id,p_selected_item_ids,p_idempotency_key,p_request_hash,p_payment_method,p_subtotal,p_discount,p_total,p_voucher_code,p_lines'),
 ('public.prepare_event_checkout(uuid,date,uuid,integer,text,text,text)','prepare_event_checkout','event_checkout_transaction_core','p_listing_id,p_pickup_date,p_slot_id,p_quantity,p_payment_method,p_idempotency_key,p_request_hash')
 ) AS t(a,b,c,d) LOOP
  SELECT source,arguments,owner_schema INTO src,args,implementation_schema FROM app_private.guest_migration_source(signature);
  IF name='prepare_checkout' AND position('checkout_product_snapshot_mismatch' IN src)=0 THEN
   -- Port the existing paid-price/snapshot hardening to the installed core.
   -- These exact markers describe the verified deployed patch layout. An
   -- unknown layout still fails the mandatory post-patch guards below.
   src:=replace(src,'v_product_booking := v_product.requires_booking;',
    'v_product_booking := v_product.requires_booking;
     IF v_line.product_name IS DISTINCT FROM v_product.name OR v_line.image_url IS DISTINCT FROM v_product.cover_url THEN RAISE EXCEPTION ''checkout_product_snapshot_mismatch''; END IF;
     IF v_line.outlet_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.outlets WHERE id=v_line.outlet_id AND vendor_id=v_line.vendor_id AND status=''active'') THEN RAISE EXCEPTION ''product_not_purchasable_at_outlet''; END IF;');
   src:=replace(src,'IF NOT FOUND THEN RAISE EXCEPTION ''variant_not_purchasable''; END IF;',
    'IF NOT FOUND THEN RAISE EXCEPTION ''variant_not_purchasable''; END IF;
     IF v_variant.name IS DISTINCT FROM v_line.variant_name THEN RAISE EXCEPTION ''checkout_variant_snapshot_mismatch''; END IF;');
   src:=replace(src,'IF NOT FOUND THEN RAISE EXCEPTION ''booking_slot_invalid''; END IF;',
    'IF NOT FOUND THEN RAISE EXCEPTION ''booking_slot_invalid''; END IF;
     IF v_line.slot_starts_at IS DISTINCT FROM v_slot.starts_at THEN RAISE EXCEPTION ''checkout_slot_snapshot_mismatch''; END IF;');
   src:=replace(src,E'IF v_is_free THEN\n      v_authoritative_price := v_product.base_price + COALESCE(v_variant.price_offset, 0);',
    'v_authoritative_price := v_product.base_price + COALESCE(v_variant.price_offset, 0);
     IF v_product.outlet_id IS NULL AND v_line.outlet_id IS NOT NULL THEN
       SELECT price+COALESCE(v_variant.price_offset,0) INTO v_authoritative_price FROM public.outlet_offers
         WHERE product_id=v_product.id AND outlet_id=v_line.outlet_id AND status=''active'' FOR SHARE;
       IF NOT FOUND THEN RAISE EXCEPTION ''product_not_purchasable_at_outlet''; END IF;
     END IF;');
   src:=replace(src,'IF ROUND(v_authoritative_price, 2) <> 0 THEN','IF v_is_free AND ROUND(v_authoritative_price, 2) <> 0 THEN');
   src:=replace(src,'IF ROUND(v_line.unit_price, 2) <> ROUND(v_authoritative_price, 2)',
    'IF v_line.unit_price IS NULL OR v_line.line_total IS NULL OR v_line.unit_price<0 OR ROUND(v_line.unit_price, 2) <> ROUND(v_authoritative_price, 2)');
   src:=replace(src,E'    END IF;\n\n    v_line_sum := v_line_sum + v_line.line_total;',E'\n    v_line_sum := v_line_sum + v_line.line_total;');
   src:=replace(src,E'  IF v_is_free THEN\n    SELECT COUNT(DISTINCT x.cart_item_id)',E'  SELECT COUNT(DISTINCT x.cart_item_id)');
   src:=replace(src,E'  END IF;\n\n  IF ROUND(v_line_sum, 2) <> ROUND(p_subtotal, 2)',E'\n  IF ROUND(v_line_sum, 2) <> ROUND(p_subtotal, 2)');
  END IF;
  IF position('v_user UUID := auth.uid();' IN src)=0 OR position('checkout_auth_required' IN src)=0 THEN RAISE EXCEPTION 'checkout_source_preflight_required: %',name; END IF;
  src:=replace(src,'v_user UUID := auth.uid();','v_user UUID := p_owner_user;');
  src:=replace(src,'IF v_user IS NULL THEN RAISE EXCEPTION ''checkout_auth_required''; END IF;',
    'PERFORM public.validate_checkout_subject(v_user,p_owner_guest,p_contact);
     IF p_owner_guest IS NOT NULL AND p_payment_method IN (''wallet'',''wallet_split'') THEN RAISE EXCEPTION ''guest_account_feature_denied''; END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(v_user,p_owner_guest)::text||p_idempotency_key,0));');
  src:=replace(src,'WHERE user_id = v_user AND idempotency_key = p_idempotency_key','WHERE user_id IS NOT DISTINCT FROM v_user AND guest_subject_id IS NOT DISTINCT FROM p_owner_guest AND idempotency_key = p_idempotency_key');
  IF name='prepare_checkout' THEN
   IF position('v_eligible_subtotal' IN src)=0 OR position('checkout_variant_snapshot_mismatch' IN src)=0 OR position('checkout_product_snapshot_mismatch' IN src)=0 OR position('checkout_slot_snapshot_mismatch' IN src)=0 OR position('product_not_purchasable_at_outlet' IN src)=0 THEN RAISE EXCEPTION 'checkout_patch_chain_preflight_required'; END IF;
   owner_check:='SELECT user_id INTO v_cart_user FROM public.carts WHERE id = p_cart_id;
  IF v_cart_user IS NULL OR v_cart_user <> v_user THEN RAISE EXCEPTION ''cart_not_owned''; END IF;';
   IF position(owner_check IN src)=0 THEN RAISE EXCEPTION 'cart_owner_source_preflight_required'; END IF;
   src:=replace(src,owner_check,'IF NOT EXISTS(SELECT 1 FROM public.carts WHERE id=p_cart_id AND user_id IS NOT DISTINCT FROM v_user AND guest_subject_id IS NOT DISTINCT FROM p_owner_guest) THEN RAISE EXCEPTION ''cart_not_owned''; END IF;
   IF p_owner_guest IS NOT NULL AND nullif(trim(p_voucher_code),'''') IS NOT NULL THEN RAISE EXCEPTION ''guest_account_feature_denied''; END IF;');
   src:=replace(src,'public.orders(user_id, status,','public.orders(user_id, guest_subject_id, contact_email, contact_name, contact_phone, status,');
   src:=replace(src,'VALUES (v_user, v_order_status,','VALUES (v_user,p_owner_guest,p_contact->>''email'',p_contact->>''name'',p_contact->>''phone'', v_order_status,');
   src:=replace(src,'public.checkout_sessions(user_id, cart_id,','public.checkout_sessions(user_id, guest_subject_id, cart_id,');
   src:=replace(src,'VALUES (v_user, p_cart_id,','VALUES (v_user,p_owner_guest, p_cart_id,');
   src:=replace(src,'customer_id, demo_qr_code','customer_id, guest_subject_id, demo_qr_code');
   src:=replace(src,'v_line.slot_id, v_user, ''MY-''','v_line.slot_id, v_user,p_owner_guest, ''MY-''');
   src:=replace(src,'customer_id, policy,','customer_id, guest_subject_id, policy,');
   src:=replace(src,'v_booking_id, v_order_item_id, v_user,','v_booking_id, v_order_item_id, v_user,p_owner_guest,');
  ELSE
   IF position('event_units_taken' IN src)=0 OR position('pickup_slot_id' IN src)=0 THEN RAISE EXCEPTION 'event_patch_chain_preflight_required'; END IF;
   src:=replace(src,'INSERT INTO public.carts (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_cart_id FROM public.carts WHERE user_id = v_user;',
   'IF p_owner_guest IS NULL THEN
    INSERT INTO public.carts(user_id) VALUES(v_user) ON CONFLICT(user_id) DO NOTHING;
   ELSE
    INSERT INTO public.carts(guest_subject_id) VALUES(p_owner_guest) ON CONFLICT(guest_subject_id) DO NOTHING;
   END IF;
   SELECT id INTO v_cart_id FROM public.carts WHERE user_id IS NOT DISTINCT FROM v_user AND guest_subject_id IS NOT DISTINCT FROM p_owner_guest;');
   src:=replace(src,'public.orders (user_id, status,','public.orders (user_id, guest_subject_id, contact_email, contact_name, contact_phone, status,');
   src:=replace(src,'VALUES (v_user, CASE WHEN v_is_free','VALUES (v_user,p_owner_guest,p_contact->>''email'',p_contact->>''name'',p_contact->>''phone'', CASE WHEN v_is_free');
   src:=replace(src,'public.checkout_sessions (user_id, cart_id,','public.checkout_sessions (user_id, guest_subject_id, cart_id,');
   src:=replace(src,'VALUES (v_user, v_cart_id,','VALUES (v_user,p_owner_guest, v_cart_id,');
  END IF;
  EXECUTE format('CREATE FUNCTION public.%I(%s,p_owner_user UUID,p_owner_guest UUID,p_contact JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS %L',core,args,src);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role',core,replace(replace(signature,'public.'||name||'(',''),')',''));
  EXECUTE format('CREATE OR REPLACE FUNCTION %I.%I(%s) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS %L',implementation_schema,name,args,
   'BEGIN RETURN public.'||core||'('||call_args||',auth.uid(),NULL,(SELECT jsonb_build_object(''email'',email,''name'',full_name,''phone'',phone) FROM public.users WHERE id=auth.uid())); END;');
  EXECUTE format('CREATE FUNCTION public.guest_%I(%s,p_guest_subject_id UUID,p_contact JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS %L',name,args,
   'BEGIN RETURN public.'||core||'('||call_args||',NULL,p_guest_subject_id,p_contact); END;');
  EXECUTE format('REVOKE ALL ON FUNCTION public.guest_%I(%s,uuid,jsonb) FROM PUBLIC,anon,authenticated',name,replace(replace(signature,'public.'||name||'(',''),')',''));
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.guest_%I(%s,uuid,jsonb) TO service_role',name,replace(replace(signature,'public.'||name||'(',''),')',''));
 END LOOP;
 -- Reuse food-mode validation/persistence, with guest's claim prohibition.
 SELECT source,arguments INTO src,args FROM app_private.guest_migration_source('public.prepare_checkout_with_food_service_modes(uuid,uuid[],text,text,text,numeric,numeric,numeric,text,uuid,jsonb,jsonb)');
 src:=replace(src,'IF v_user IS NULL THEN RAISE EXCEPTION ''checkout_auth_required''; END IF;',
 'PERFORM public.validate_checkout_subject(NULL,p_guest_subject_id,p_contact);
  IF p_claim_id IS NOT NULL THEN RAISE EXCEPTION ''guest_account_feature_denied''; END IF;');
 src:=replace(src,'v_result := public.prepare_checkout(','v_result := public.guest_prepare_checkout(');
 src:=replace(src,'p_payment_method, p_subtotal, p_discount, p_total, p_voucher_code, p_lines','p_payment_method, p_subtotal, p_discount, p_total, p_voucher_code, p_lines,p_guest_subject_id,p_contact');
 -- Remove unreachable claim overload rather than resolving a nonexistent function.
 src:=regexp_replace(src,'ELSE[[:space:]]+v_result := public.guest_prepare_checkout\([[:space:]]*p_cart_id, p_selected_item_ids, p_idempotency_key, p_request_hash,[[:space:]]*p_payment_method, p_subtotal, p_discount, p_total, p_voucher_code, p_claim_id, p_lines[[:space:]]*\);','');
 EXECUTE format('CREATE FUNCTION public.guest_prepare_checkout_with_food_service_modes(%s,p_guest_subject_id UUID,p_contact JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS %L',args,src);
END; $migration$;
REVOKE ALL ON FUNCTION public.guest_prepare_checkout_with_food_service_modes(UUID,UUID[],TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,UUID,JSONB,JSONB,UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_prepare_checkout_with_food_service_modes(UUID,UUID[],TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,UUID,JSONB,JSONB,UUID,JSONB) TO service_role;
DO $$ DECLARE src TEXT; BEGIN
 src:=pg_get_functiondef('public.finalize_checkout(uuid,text,text,text)'::regprocedure);
 -- Some installed patch chains retain variant-only inventory predicates.
 -- Restore the same outlet scope for both release and commit before exposing
 -- guest settlement; never relax the finalizer preflight.
 src:=regexp_replace(src,
  '(WHERE variant_id = v_reservation[.]variant_id)(?![[:space:]]+AND outlet_id IS NOT DISTINCT FROM v_reservation[.]outlet_id)',
  '\1 AND outlet_id IS NOT DISTINCT FROM v_reservation.outlet_id','g');
 IF position('outlet_id IS NOT DISTINCT FROM v_reservation.outlet_id' IN src)=0 OR position('cart_item_id' IN src)=0 THEN RAISE EXCEPTION 'finalize_patch_chain_preflight_required'; END IF;
 src:=replace(src,'v_user <> v_session.user_id','v_user IS DISTINCT FROM v_session.user_id');
 EXECUTE src;
END; $$;
NOTIFY pgrst,'reload schema';

CREATE FUNCTION public.guest_cancel_checkout(p_checkout_session_id UUID,p_guest_subject_id UUID,p_outcome TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_outcome IS NULL OR p_outcome NOT IN ('failed','cancelled','expired') OR NOT EXISTS(SELECT 1 FROM public.checkout_sessions WHERE id=p_checkout_session_id AND guest_subject_id=p_guest_subject_id AND user_id IS NULL) THEN RAISE EXCEPTION 'checkout_not_owned'; END IF;
 RETURN public.finalize_checkout(p_checkout_session_id,p_outcome,NULL,NULL);
END; $$;
REVOKE ALL ON FUNCTION public.guest_cancel_checkout(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_cancel_checkout(UUID,UUID,TEXT) TO service_role;
-- Freeze the selected non-identity contact phone atomically with account prepare.
-- The account email is always taken from public.users by the original wrapper.
DO $migration$
DECLARE signature TEXT; name TEXT; args TEXT; call_args TEXT; src TEXT;
BEGIN
 FOR signature,name,call_args IN SELECT * FROM (VALUES
 ('public.prepare_checkout(uuid,uuid[],text,text,text,numeric,numeric,numeric,text,jsonb)','prepare_checkout','p_cart_id,p_selected_item_ids,p_idempotency_key,p_request_hash,p_payment_method,p_subtotal,p_discount,p_total,p_voucher_code,p_lines'),
 ('public.prepare_checkout_with_food_service_modes(uuid,uuid[],text,text,text,numeric,numeric,numeric,text,uuid,jsonb,jsonb)','prepare_checkout_with_food_service_modes','p_cart_id,p_selected_item_ids,p_idempotency_key,p_request_hash,p_payment_method,p_subtotal,p_discount,p_total,p_voucher_code,p_claim_id,p_lines,p_food_service_modes'),
 ('public.prepare_event_checkout(uuid,date,uuid,integer,text,text,text)','prepare_event_checkout','p_listing_id,p_pickup_date,p_slot_id,p_quantity,p_payment_method,p_idempotency_key,p_request_hash')
 ) AS t(a,b,c) LOOP
  SELECT pg_get_function_arguments(oid) INTO args FROM pg_proc WHERE oid=signature::regprocedure;
  src:='DECLARE result JSONB; existing_attempt BOOLEAN; BEGIN
   IF auth.uid() IS NULL THEN RAISE EXCEPTION ''checkout_auth_required''; END IF;
   IF length(coalesce(p_contact->>''phone'',''''))>32 THEN RAISE EXCEPTION ''contact_phone_invalid''; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_idempotency_key,0));
   SELECT EXISTS(SELECT 1 FROM public.checkout_sessions WHERE user_id=auth.uid() AND idempotency_key=p_idempotency_key) INTO existing_attempt;
   result:=public.'||name||'('||call_args||');
   IF NOT existing_attempt THEN
   UPDATE public.orders SET contact_phone=nullif(p_contact->>''phone'','''') WHERE id=(result->>''order_id'')::uuid AND user_id=auth.uid();
   END IF;
   RETURN result; END;';
  EXECUTE format('CREATE FUNCTION public.account_%I(%s,p_contact JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS %L',name,args,src);
  EXECUTE format('REVOKE ALL ON FUNCTION public.account_%I(%s,jsonb) FROM PUBLIC,anon',name,replace(replace(signature,'public.'||name||'(',''),')',''));
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.account_%I(%s,jsonb) TO authenticated',name,replace(replace(signature,'public.'||name||'(',''),')',''));
 END LOOP;
END; $migration$;
