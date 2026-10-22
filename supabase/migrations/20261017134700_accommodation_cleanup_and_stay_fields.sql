-- Phase 1 of property-first accommodation: clean the accommodation catalogue and add hotel stay fields.
-- Idempotent. Touches no order, payment, wallet or refund rows.

ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS check_in_time time,
  ADD COLUMN IF NOT EXISTS check_out_time time,
  ADD COLUMN IF NOT EXISTS stay_policies text;

-- Food items mis-filed as accommodation.
UPDATE public.products
SET category_id = '11111111-0000-0000-0000-000000000001'
WHERE category_id = '11111111-0000-0000-0000-000000000008'
  AND id IN (
    'ed1a9eb9-4eea-4121-a77e-f275202b30f3', '324aba1b-fe1b-4183-ada5-30a4161a1e43', '1c502343-92ab-46ed-a56e-60f2dd9d07a5',
    '303883af-fd88-4dec-a847-4c0e3817c896', 'f8e93889-2d2c-4527-a7d2-aa653a88fe3e', 'ae0e647f-a0e3-41f9-a0e3-a0109f321be3',
    'ecec6ec6-1c42-43eb-a37a-dbf099a266cc', 'cbb52ac6-585f-4d07-ad1f-37862efff25c', 'debd316d-4dd9-4655-abf6-13d4cd9a6ed5',
    '0f238b52-e3df-4db4-aab3-3072c29ee6af', '82811305-bf45-4ab6-a515-c92aca3527fa', 'e193aee3-05b1-4e59-a560-ec616b47f3f7'
  );

-- Blue Mansion tours mis-filed as accommodation.
UPDATE public.products
SET category_id = '22222222-0000-0000-0000-000000000001'
WHERE category_id = '11111111-0000-0000-0000-000000000008'
  AND id IN (
    '2873e7d5-c098-46a9-ad32-9eb25e2953e9', '81fbff1f-b1ae-4a42-ad60-aa771693542c', '222355d7-9e49-434b-aa9a-98dcfae061c7'
  );

-- Hide Breakfast Packages and room packages (decided later).
UPDATE public.products
SET status = 'inactive'
WHERE category_id = '11111111-0000-0000-0000-000000000008'
  AND status <> 'inactive'
  AND id IN (
    '77682f3c-d259-483b-acf5-88946e21619c', 'afc6cf45-df95-464f-ab0b-0dbb4e74b0ff',
    'b8fa289d-56e7-4f1b-a94e-34a70df7ea64', '7b0f56f7-bad5-4a2a-a036-4eb98c5f9d38',
    '7e1ca960-1b73-468c-adb6-2db943bd0c4e', '1ed67e2c-1ff4-4567-acb0-f9157bb48086',
    '55b38299-f3bd-4ceb-a6e3-098302d6652d', '2ecef66c-1f46-467a-a5e1-039c3787b34d',
    '08cc4b68-0e7b-471d-af86-908c2df21f64', 'cc6e32b6-e3fc-4e40-aff3-90e5e6b0efad'
  );

-- Hotels = outlets with an active accommodation product, via an offer or a direct binding.
CREATE TEMP TABLE _stay_hotels AS
SELECT DISTINCT outlet_id AS id FROM (
  SELECT oo.outlet_id FROM public.outlet_offers oo
    JOIN public.products p ON p.id = oo.product_id
    WHERE p.category_id = '11111111-0000-0000-0000-000000000008' AND p.status = 'active' AND oo.status = 'active'
  UNION ALL
  SELECT p.outlet_id FROM public.products p
    WHERE p.category_id = '11111111-0000-0000-0000-000000000008' AND p.status = 'active' AND p.outlet_id IS NOT NULL
) s WHERE outlet_id IS NOT NULL;

UPDATE public.outlets o
SET check_in_time = COALESCE(o.check_in_time, '15:00'),
    check_out_time = COALESCE(o.check_out_time, '12:00'),
    stay_policies = COALESCE(o.stay_policies,
      'Check-in from 15:00 and check-out by 12:00. Government-issued photo ID is required at check-in. Additional charges may apply for extra guests or late check-out.'),
    address = CASE WHEN COALESCE(o.address, '') = ''
      THEN concat_ws(', ', o.name, NULLIF(o.city, ''), NULLIF(o.state, '')) ELSE o.address END
FROM _stay_hotels h
WHERE h.id = o.id;

UPDATE public.outlet_pages op
SET seo_description = format('Stay at %s. Compare room types and book your nights online.', o.name)
FROM public.outlets o, _stay_hotels h
WHERE op.outlet_id = o.id AND o.id = h.id AND COALESCE(op.seo_description, '') = '';

INSERT INTO public.outlet_pages (outlet_id, seo_description)
SELECT o.id, format('Stay at %s. Compare room types and book your nights online.', o.name)
FROM public.outlets o
JOIN _stay_hotels h ON h.id = o.id
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_pages op WHERE op.outlet_id = o.id);

DROP TABLE _stay_hotels;

NOTIFY pgrst, 'reload schema';
