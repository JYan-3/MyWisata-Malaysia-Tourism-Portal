-- Real installed transaction bodies, isolated data, and transactional rollback.
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL request.jwt.claim.sub='';
DO $$
DECLARE guest uuid; cart uuid; item uuid; product uuid:=gen_random_uuid(); variant uuid:=gen_random_uuid();
  outlet uuid:=gen_random_uuid(); lines jsonb; result jsonb; repeated jsonb; actual text;
BEGIN
  INSERT INTO public.guest_checkout_subjects(token_hash,expires_at) VALUES(repeat('f',64),now()+interval '1 day') RETURNING id INTO guest;
  INSERT INTO public.carts(guest_subject_id) VALUES(guest) RETURNING id INTO cart;
  INSERT INTO public.outlets(id,vendor_id,name,slug,status) VALUES(outlet,'11111111-1111-4111-8111-111111111111','Rollout test outlet',outlet::text,'active');
  INSERT INTO public.products(id,vendor_id,name,slug,base_price,requires_booking,status,review_status)
    VALUES(product,'11111111-1111-4111-8111-111111111111','Rollout test item',product::text,10,false,'active','approved');
  INSERT INTO public.product_variants(id,product_id,name,price_offset,is_active) VALUES(variant,product,'Standard',2,true);
  INSERT INTO public.outlet_offers(product_id,outlet_id,price,status) VALUES(product,outlet,20,'active');
  INSERT INTO public.inventory(variant_id,outlet_id,quantity,reserved) VALUES(variant,outlet,10,0);
  INSERT INTO public.cart_items(cart_id,variant_id,outlet_id,quantity,unit_price) VALUES(cart,variant,outlet,1,1) RETURNING id INTO item;
  lines:=jsonb_build_array(jsonb_build_object('cart_item_id',item,'product_id',product,'variant_id',variant,'slot_id',NULL,
    'vendor_id','11111111-1111-4111-8111-111111111111','outlet_id',outlet,'product_name','Rollout test item','image_url',NULL,
    'variant_name','Standard','slot_starts_at',NULL,'unit_price',1,'quantity',1,'line_total',1,'requires_booking',false));
  BEGIN PERFORM public.guest_prepare_checkout(cart,ARRAY[item],'forged-price','fixture','mock_card',1,0,1,NULL,lines,guest,'{"email":"guest@example.test"}');
    EXCEPTION WHEN OTHERS THEN actual:=SQLERRM; END;
  IF actual IS DISTINCT FROM 'checkout_line_price_mismatch' THEN RAISE EXCEPTION 'forged paid price was not rejected: %',actual; END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE guest_subject_id=guest) OR EXISTS(SELECT 1 FROM public.inventory WHERE variant_id=variant AND reserved<>0) THEN RAISE EXCEPTION 'failed pricing check changed stock/orders'; END IF;
  UPDATE public.cart_items SET unit_price=22 WHERE id=item;
  lines:=jsonb_set(jsonb_set(lines,'{0,unit_price}','22'),'{0,line_total}','22');
  result:=public.guest_prepare_checkout(cart,ARRAY[item],'valid-price','fixture','mock_card',22,0,22,NULL,lines,guest,'{"email":"guest@example.test","name":"Guest"}');
  repeated:=public.guest_prepare_checkout(cart,ARRAY[item],'valid-price','fixture','mock_card',22,0,22,NULL,lines,guest,'{"email":"guest@example.test","name":"Guest"}');
  IF result->>'order_id' IS DISTINCT FROM repeated->>'order_id' OR (SELECT count(*) FROM public.orders WHERE guest_subject_id=guest)<>1 THEN RAISE EXCEPTION 'guest idempotency created duplicate orders'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=(result->>'order_id')::uuid AND user_id IS NULL AND guest_subject_id=guest AND contact_email='guest@example.test') THEN RAISE EXCEPTION 'guest contact/ownership was lost'; END IF;
  IF (SELECT reserved FROM public.inventory WHERE variant_id=variant AND outlet_id=outlet)<>1 THEN RAISE EXCEPTION 'guest stock reservation was not scoped'; END IF;
  PERFORM public.guest_cancel_checkout((result->>'checkout_session_id')::uuid,guest,'cancelled');
  IF (SELECT reserved FROM public.inventory WHERE variant_id=variant AND outlet_id=outlet)<>0 THEN RAISE EXCEPTION 'guest cancellation did not release the held stock'; END IF;
END; $$;

SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
DO $$ DECLARE decision jsonb; BEGIN
  UPDATE public.users SET phone_verified_at=NULL,profile_completed_at=NULL,kyc_status='none' WHERE id=auth.uid();
  decision:=public.capability_hard_guard(auth.uid(),'commerce.checkout');
  IF NOT (decision->>'allowed')::boolean THEN RAISE EXCEPTION 'email-only purchase was not permitted'; END IF;
  decision:=public.capability_hard_guard(auth.uid(),'wallet.top_up');
  IF decision->>'blockerCode'<>'PHONE_VERIFICATION_REQUIRED' THEN RAISE EXCEPTION 'top-up phone requirement changed'; END IF;
END; $$;
