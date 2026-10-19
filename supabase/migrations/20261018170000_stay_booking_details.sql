-- Persist hotel-specific guest preferences on the order created by the existing checkout
-- transaction. Order ownership and RLS remain the access-control boundary.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stay_details JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'orders_stay_details_object_check'
       AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_stay_details_object_check
      CHECK (jsonb_typeof(stay_details) = 'object');
  END IF;
END;
$constraint$;

-- Keep this additive and fail closed if the checkout definition has changed. The original
-- transaction still creates the order and reserves every night atomically; this only adds
-- the validated optional preference snapshot to that same INSERT.
DO $migration$
DECLARE
  v_core TEXT := pg_get_functiondef(
    'public.checkout_transaction_core(uuid,uuid[],text,text,text,numeric,numeric,numeric,text,jsonb,uuid,uuid,jsonb)'::regprocedure
  );
  v_contact TEXT := pg_get_functiondef(
    'app_private.apply_account_checkout_contact(uuid,jsonb,boolean)'::regprocedure
  );
  v_order_insert_old TEXT := $old$
  INSERT INTO public.orders(user_id, guest_subject_id, contact_email, contact_name, contact_phone, status, subtotal, discount_amount, total_amount, payment_method, voucher_code, paid_at)
  VALUES (v_user,p_owner_guest,p_contact->>'email',p_contact->>'name',p_contact->>'phone', v_order_status, p_subtotal, p_discount, p_total, p_payment_method, NULLIF(trim(p_voucher_code), ''), CASE WHEN v_is_free THEN NOW() ELSE NULL END)
  RETURNING id INTO v_order_id;
$old$;
  v_order_insert_new TEXT := $new$
  INSERT INTO public.orders(user_id, guest_subject_id, contact_email, contact_name, contact_phone, stay_details, status, subtotal, discount_amount, total_amount, payment_method, voucher_code, paid_at)
  VALUES (v_user,p_owner_guest,p_contact->>'email',p_contact->>'name',p_contact->>'phone', COALESCE(p_contact->'stay_details', '{}'::jsonb), v_order_status, p_subtotal, p_discount, p_total, p_payment_method, NULLIF(trim(p_voucher_code), ''), CASE WHEN v_is_free THEN NOW() ELSE NULL END)
  RETURNING id INTO v_order_id;
$new$;
  v_contact_match_old TEXT := $old$
         AND contact_phone IS NOT DISTINCT FROM v_phone
$old$;
  v_contact_match_new TEXT := $new$
         AND contact_phone IS NOT DISTINCT FROM v_phone
         AND stay_details IS NOT DISTINCT FROM COALESCE(p_contact->'stay_details', '{}'::jsonb)
$new$;
  v_contact_update_old TEXT := $old$
     SET contact_name = v_name, contact_email = v_email, contact_phone = v_phone
$old$;
  v_contact_update_new TEXT := $new$
     SET contact_name = v_name, contact_email = v_email, contact_phone = v_phone,
         stay_details = COALESCE(p_contact->'stay_details', '{}'::jsonb)
$new$;
BEGIN
  IF position(v_order_insert_old IN v_core) = 0 THEN
    RAISE EXCEPTION 'checkout_transaction_core order insert changed; inspect stay-details migration';
  END IF;
  IF position(v_contact_match_old IN v_contact) = 0
     OR position(v_contact_update_old IN v_contact) = 0 THEN
    RAISE EXCEPTION 'apply_account_checkout_contact changed; inspect stay-details migration';
  END IF;

  EXECUTE replace(v_core, v_order_insert_old, v_order_insert_new);
  v_contact := replace(v_contact, v_contact_match_old, v_contact_match_new);
  v_contact := replace(v_contact, v_contact_update_old, v_contact_update_new);
  IF position(v_contact_match_new IN v_contact) = 0
     OR position(v_contact_update_new IN v_contact) = 0 THEN
    RAISE EXCEPTION 'apply_account_checkout_contact stay-details patch incomplete';
  END IF;
  EXECUTE v_contact;
END;
$migration$;
