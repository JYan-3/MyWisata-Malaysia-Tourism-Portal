-- Keep commission rules server-only and restrict outlet reads to the explicit
-- public projection. Remove permissive legacy policies before granting reads.
REVOKE ALL PRIVILEGES ON TABLE public.commission_rules FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS commission_rules_read ON public.commission_rules;
DROP POLICY IF EXISTS "demo_allow_all" ON public.commission_rules;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.commission_rules TO service_role;

-- The authenticated write paths use service-role routes. Preserve the existing
-- active/approved row boundary and the customer-facing column allowlist.
DROP POLICY IF EXISTS "demo_allow_all" ON public.outlets;
REVOKE ALL PRIVILEGES ON TABLE public.outlets FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  vendor_id,
  name,
  slug,
  address,
  city,
  state,
  postcode,
  country,
  lat,
  lng,
  phone,
  email,
  operating_hours,
  status,
  created_at,
  updated_at,
  display_id,
  review_status,
  wheelchair_accessible,
  pet_friendly,
  welcome_message,
  welcome_enabled,
  food_service_modes,
  check_in_time,
  check_out_time,
  stay_policies,
  amenity_codes,
  hotel_about
) ON TABLE public.outlets TO anon, authenticated;
