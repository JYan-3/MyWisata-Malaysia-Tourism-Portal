-- Commission thresholds are server-side policy. Affiliate and recommendation
-- calculations already use service-role clients; public clients need no direct
-- access to this table.
REVOKE SELECT ON TABLE public.commission_rules FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS commission_rules_read ON public.commission_rules;

-- Public outlet pages need published business details, but review notes and
-- reviewer identity/timestamps are internal moderation data. Keep the existing
-- outlets_public_read row policy as the active-and-approved publication gate.
REVOKE SELECT ON TABLE public.outlets FROM PUBLIC, anon, authenticated;
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
