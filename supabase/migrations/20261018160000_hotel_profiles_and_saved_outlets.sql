-- Hotel property page: admin amenity list, live hotel profile columns, pending hotel profile
-- submissions (review without takedown) and customer saved hotels.
-- Idempotent. Touches no order, payment, wallet, refund or booking rows.

-- Admin-managed amenity checklist. Readable by everyone; written only through admin API routes (service role).
CREATE TABLE IF NOT EXISTS public.hotel_amenities (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  label_en text NOT NULL CHECK (btrim(label_en) <> ''),
  label_ms text NOT NULL CHECK (btrim(label_ms) <> ''),
  label_zh text NOT NULL CHECK (btrim(label_zh) <> ''),
  icon text NOT NULL DEFAULT 'check',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hotel_amenities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hotel_amenities_public_read ON public.hotel_amenities;
CREATE POLICY hotel_amenities_public_read
  ON public.hotel_amenities FOR SELECT TO anon, authenticated
  USING (is_active);

GRANT SELECT ON public.hotel_amenities TO anon, authenticated;

INSERT INTO public.hotel_amenities (code, label_en, label_ms, label_zh, icon, sort_order) VALUES
  ('wifi', 'Free Wi-Fi', 'Wi-Fi percuma', '免费 Wi-Fi', 'wifi', 10),
  ('free_parking', 'Free parking', 'Letak kereta percuma', '免费停车', 'car', 20),
  ('swimming_pool', 'Swimming pool', 'Kolam renang', '游泳池', 'waves', 30),
  ('gym', 'Gym', 'Gimnasium', '健身房', 'dumbbell', 40),
  ('restaurant', 'Restaurant', 'Restoran', '餐厅', 'utensils', 50),
  ('breakfast', 'Breakfast available', 'Sarapan disediakan', '提供早餐', 'coffee', 60),
  ('air_conditioning', 'Air conditioning', 'Penghawa dingin', '空调', 'snowflake', 70),
  ('front_desk_24h', '24-hour front desk', 'Kaunter depan 24 jam', '24 小时前台', 'concierge-bell', 80),
  ('airport_transfer', 'Airport transfer', 'Pemindahan lapangan terbang', '机场接送', 'plane', 90),
  ('laundry', 'Laundry service', 'Perkhidmatan dobi', '洗衣服务', 'shirt', 100),
  ('accessible', 'Accessible facilities', 'Kemudahan OKU', '无障碍设施', 'accessibility', 110),
  ('pets_allowed', 'Pets allowed', 'Haiwan peliharaan dibenarkan', '可携带宠物', 'paw-print', 120)
ON CONFLICT (code) DO NOTHING;

-- Live hotel profile fields (written only when an admin approves a submission).
ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS amenity_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hotel_about text;

-- Existing accessibility / pet flags become amenity ticks (D5).
UPDATE public.outlets
SET amenity_codes = ARRAY(
  SELECT DISTINCT unnest(amenity_codes
    || CASE WHEN wheelchair_accessible IS TRUE THEN ARRAY['accessible'] ELSE ARRAY[]::text[] END
    || CASE WHEN pet_friendly IS TRUE THEN ARRAY['pets_allowed'] ELSE ARRAY[]::text[] END))
WHERE wheelchair_accessible IS TRUE OR pet_friendly IS TRUE;

-- Pending hotel profile edits. The live outlet stays listed while a submission is pending (D4, D13).
CREATE TABLE IF NOT EXISTS public.hotel_profile_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hotel_profile_submissions_one_pending
  ON public.hotel_profile_submissions (outlet_id) WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS idx_hotel_profile_submissions_outlet_created
  ON public.hotel_profile_submissions (outlet_id, created_at DESC);

-- No client policies: vendor and admin API routes use the service role.
ALTER TABLE public.hotel_profile_submissions ENABLE ROW LEVEL SECURITY;

-- Customer saved hotels (D10), mirroring customer_saved_destinations.
CREATE TABLE IF NOT EXISTS public.customer_saved_outlets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, outlet_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_saved_outlets_user_created
  ON public.customer_saved_outlets (user_id, created_at DESC);

ALTER TABLE public.customer_saved_outlets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_saved_outlets_select_own ON public.customer_saved_outlets;
CREATE POLICY customer_saved_outlets_select_own
  ON public.customer_saved_outlets FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS customer_saved_outlets_insert_own ON public.customer_saved_outlets;
CREATE POLICY customer_saved_outlets_insert_own
  ON public.customer_saved_outlets FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS customer_saved_outlets_delete_own ON public.customer_saved_outlets;
CREATE POLICY customer_saved_outlets_delete_own
  ON public.customer_saved_outlets FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, DELETE ON public.customer_saved_outlets TO authenticated;

-- Saved accommodation rooms become saved hotels, then the room saves are removed.
INSERT INTO public.customer_saved_outlets (user_id, outlet_id)
SELECT DISTINCT w.user_id,
       COALESCE(p.outlet_id, (
         SELECT oo.outlet_id FROM public.outlet_offers oo
         WHERE oo.product_id = p.id AND oo.status = 'active'
         ORDER BY oo.outlet_id LIMIT 1))
FROM public.customer_wishlists w
JOIN public.products p ON p.id = w.product_id
WHERE p.category_id = '11111111-0000-0000-0000-000000000008'
  AND COALESCE(p.outlet_id, (
         SELECT oo.outlet_id FROM public.outlet_offers oo
         WHERE oo.product_id = p.id AND oo.status = 'active'
         ORDER BY oo.outlet_id LIMIT 1)) IS NOT NULL
ON CONFLICT (user_id, outlet_id) DO NOTHING;

DELETE FROM public.customer_wishlists w
USING public.products p
WHERE p.id = w.product_id AND p.category_id = '11111111-0000-0000-0000-000000000008';

NOTIFY pgrst, 'reload schema';
