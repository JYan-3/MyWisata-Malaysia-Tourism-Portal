-- Keep accommodation guest details on the cart/order line they belong to.
-- This migration intentionally sorts before 20261018170000_stay_booking_details;
-- that migration's guarded patch changes only the order-level snapshot insert.
ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS stay_details JSONB;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS stay_details JSONB;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cart_items_stay_details_object_check'
       AND conrelid = 'public.cart_items'::regclass
  ) THEN
    ALTER TABLE public.cart_items
      ADD CONSTRAINT cart_items_stay_details_object_check
      CHECK (stay_details IS NULL OR jsonb_typeof(stay_details) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'order_items_stay_details_object_check'
       AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_stay_details_object_check
      CHECK (stay_details IS NULL OR jsonb_typeof(stay_details) = 'object');
  END IF;
END;
$constraints$;

-- Patch only the existing core's cart-line validation and order-item snapshot.
-- The later order-level stay migration can therefore apply its independent patch.
DO $migration$
DECLARE
  v_core TEXT := pg_get_functiondef(
    'public.checkout_transaction_core(uuid,uuid[],text,text,text,numeric,numeric,numeric,text,jsonb,uuid,uuid,jsonb)'::regprocedure
  );
  v_line_shape_old TEXT := 'requires_booking BOOLEAN, nights INTEGER';
  v_line_shape_new TEXT := 'requires_booking BOOLEAN, nights INTEGER, stay_details JSONB';
  v_validation_old TEXT := $old$
    v_is_stay := v_product_booking AND v_product.category_id = v_acc;
    IF NOT v_is_stay AND v_nights <> 1 THEN RAISE EXCEPTION 'invalid_line_nights'; END IF;
$old$;
  v_validation_new TEXT := $new$
    v_is_stay := v_product_booking AND v_product.category_id = v_acc;
    IF v_is_stay THEN
      IF v_cart_item.stay_details IS NULL
         OR v_line.stay_details IS DISTINCT FROM v_cart_item.stay_details
         OR jsonb_typeof(v_cart_item.stay_details->'primaryGuestName') IS DISTINCT FROM 'string'
         OR COALESCE(NULLIF(BTRIM(v_cart_item.stay_details->>'primaryGuestName'), ''), '') = ''
         OR char_length(v_cart_item.stay_details->>'primaryGuestName') > 100
         OR jsonb_typeof(v_cart_item.stay_details->'adults') IS DISTINCT FROM 'number'
         OR CASE
              WHEN COALESCE(v_cart_item.stay_details->>'adults', '') ~ '^[0-9]+$'
              THEN (v_cart_item.stay_details->>'adults')::INTEGER NOT BETWEEN 1 AND 20
                   OR (v_cart_item.stay_details->>'adults')::INTEGER::NUMERIC <> (v_cart_item.stay_details->>'adults')::NUMERIC
              ELSE true
            END
         OR COALESCE(v_cart_item.stay_details->>'estimatedArrival', '') NOT IN ('unknown', '15:00-18:00', '18:00-21:00', 'after-21:00')
         OR CASE
              WHEN v_cart_item.stay_details ? 'additionalGuestNames'
                   AND jsonb_typeof(v_cart_item.stay_details->'additionalGuestNames') = 'array'
                   AND COALESCE(v_cart_item.stay_details->>'adults', '') ~ '^[0-9]+$'
              THEN jsonb_array_length(v_cart_item.stay_details->'additionalGuestNames') > ((v_cart_item.stay_details->>'adults')::INTEGER - 1)
                   OR EXISTS (
                     SELECT 1
                       FROM jsonb_array_elements(v_cart_item.stay_details->'additionalGuestNames') AS guest(value)
                      WHERE jsonb_typeof(guest.value) IS DISTINCT FROM 'string'
                         OR COALESCE(NULLIF(BTRIM(guest.value #>> '{}'), ''), '') = ''
                         OR char_length(guest.value #>> '{}') > 100
                   )
              WHEN v_cart_item.stay_details ? 'additionalGuestNames' THEN true
              ELSE false
            END
         OR CASE
              WHEN v_cart_item.stay_details ? 'specialRequest'
              THEN jsonb_typeof(v_cart_item.stay_details->'specialRequest') NOT IN ('string', 'null')
                   OR COALESCE(char_length(v_cart_item.stay_details->>'specialRequest') > 500, false)
              ELSE false
            END
         OR EXISTS (
              SELECT 1
                FROM jsonb_object_keys(v_cart_item.stay_details) AS detail(key)
               WHERE detail.key NOT IN ('primaryGuestName', 'additionalGuestNames', 'adults', 'estimatedArrival', 'specialRequest')
            )
      THEN
        RAISE EXCEPTION 'stay_guest_details_required';
      END IF;
    ELSIF v_cart_item.stay_details IS NOT NULL OR v_line.stay_details IS NOT NULL THEN
      RAISE EXCEPTION 'stay_details_not_allowed';
    END IF;
    IF NOT v_is_stay AND v_nights <> 1 THEN RAISE EXCEPTION 'invalid_line_nights'; END IF;
$new$;
  v_order_item_insert_old TEXT := $old$
    INSERT INTO public.order_items(order_id, vendor_id, outlet_id, product_id, variant_id, slot_id, product_name, image_url, variant_name, slot_starts_at, unit_price, quantity, line_total, nights, fulfil_status)
    VALUES (v_order_id, v_line.vendor_id, v_line.outlet_id, v_line.product_id, v_line.variant_id, v_line.slot_id, v_line.product_name, v_line.image_url, v_line.variant_name, v_line.slot_starts_at, v_line.unit_price, v_line.quantity, v_line.line_total, v_nights, 'pending')
$old$;
  v_order_item_insert_new TEXT := $new$
    INSERT INTO public.order_items(order_id, vendor_id, outlet_id, product_id, variant_id, slot_id, product_name, image_url, variant_name, slot_starts_at, unit_price, quantity, line_total, nights, stay_details, fulfil_status)
    VALUES (v_order_id, v_line.vendor_id, v_line.outlet_id, v_line.product_id, v_line.variant_id, v_line.slot_id, v_line.product_name, v_line.image_url, v_line.variant_name, v_line.slot_starts_at, v_line.unit_price, v_line.quantity, v_line.line_total, v_nights, v_line.stay_details, 'pending')
$new$;
  v_shape_count INTEGER;
BEGIN
  v_shape_count := (length(v_core) - length(replace(v_core, v_line_shape_old, ''))) / length(v_line_shape_old);
  IF v_shape_count <> 2 THEN
    RAISE EXCEPTION 'checkout_transaction_core line shape changed; inspect stay-details-before-cart migration';
  END IF;
  IF position(v_validation_old IN v_core) = 0 THEN
    RAISE EXCEPTION 'checkout_transaction_core stay validation changed; inspect stay-details-before-cart migration';
  END IF;
  IF position(v_order_item_insert_old IN v_core) = 0 THEN
    RAISE EXCEPTION 'checkout_transaction_core order-item insert changed; inspect stay-details-before-cart migration';
  END IF;

  v_core := replace(v_core, v_line_shape_old, v_line_shape_new);
  v_core := replace(v_core, v_validation_old, v_validation_new);
  v_core := replace(v_core, v_order_item_insert_old, v_order_item_insert_new);
  IF position(v_validation_new IN v_core) = 0 OR position(v_order_item_insert_new IN v_core) = 0 THEN
    RAISE EXCEPTION 'checkout_transaction_core stay-details patch incomplete';
  END IF;
  EXECUTE v_core;
END;
$migration$;
