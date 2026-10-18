-- Hotel profile review (D4, D13, D14): an admin-approved submission becomes the live hotel profile in one
-- transaction. The outlet's status and review_status are never touched, so the hotel stays listed.

-- Review history can now record hotel profile reviews.
ALTER TABLE public.content_reviews DROP CONSTRAINT IF EXISTS content_reviews_entity_type_check;
ALTER TABLE public.content_reviews ADD CONSTRAINT content_reviews_entity_type_check
  CHECK (entity_type::text = ANY (ARRAY['outlet', 'product', 'voucher', 'hotel_profile']::text[]));

CREATE OR REPLACE FUNCTION app_private.apply_hotel_profile_submission(p_submission_id uuid, p_reviewer uuid, p_expected_updated_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub public.hotel_profile_submissions%ROWTYPE;
  p jsonb;
  v_codes text[];
BEGIN
  SELECT * INTO v_sub FROM public.hotel_profile_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'hotel_profile_submission_not_found'; END IF;
  IF v_sub.status <> 'pending_review' THEN RAISE EXCEPTION 'hotel_profile_submission_not_pending'; END IF;
  -- The vendor may resubmit while the admin is reviewing; apply only the version the admin saw.
  IF v_sub.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'hotel_profile_submission_changed'; END IF;

  p := v_sub.payload;
  v_codes := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'amenityCodes', '[]'::jsonb)));

  UPDATE public.outlets o
  SET hotel_about = NULLIF(btrim(p->>'about'), ''),
      amenity_codes = v_codes,
      check_in_time = (p->>'checkInTime')::time,
      check_out_time = (p->>'checkOutTime')::time,
      stay_policies = NULLIF(btrim(p->>'policies'), ''),
      name = COALESCE(NULLIF(btrim(p->>'name'), ''), o.name),
      address = CASE WHEN p ? 'address' THEN p->>'address' ELSE o.address END,
      city = CASE WHEN p ? 'city' THEN p->>'city' ELSE o.city END,
      state = CASE WHEN p ? 'state' THEN p->>'state' ELSE o.state END,
      postcode = CASE WHEN p ? 'postcode' THEN p->>'postcode' ELSE o.postcode END,
      country = CASE WHEN p ? 'country' THEN p->>'country' ELSE o.country END,
      phone = CASE WHEN p ? 'phone' THEN p->>'phone' ELSE o.phone END,
      email = CASE WHEN p ? 'email' THEN NULLIF(p->>'email', '') ELSE o.email END,
      lat = CASE WHEN p ? 'lat' THEN (p->>'lat')::numeric ELSE o.lat END,
      lng = CASE WHEN p ? 'lng' THEN (p->>'lng')::numeric ELSE o.lng END,
      wheelchair_accessible = 'accessible' = ANY (v_codes),
      pet_friendly = 'pets_allowed' = ANY (v_codes)
  WHERE o.id = v_sub.outlet_id;

  -- The approved photo list replaces the outlet gallery; the logo row (sort_order -1) is kept.
  -- Alt text of photos that stay in the gallery is carried over by URL.
  WITH removed AS (
    DELETE FROM public.media_assets
    WHERE outlet_id = v_sub.outlet_id AND product_id IS NULL AND COALESCE(sort_order, 0) <> -1
    RETURNING url, alt_text
  )
  INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text)
  SELECT v_sub.vendor_id, v_sub.outlet_id, photo.url, 'image', (photo.position - 1)::int,
         (SELECT r.alt_text FROM removed r WHERE r.url = photo.url AND r.alt_text IS NOT NULL LIMIT 1)
  FROM jsonb_array_elements_text(COALESCE(p->'photos', '[]'::jsonb)) WITH ORDINALITY AS photo(url, position);

  UPDATE public.hotel_profile_submissions
  SET status = 'approved', reviewed_by = p_reviewer, reviewed_at = now(), updated_at = now()
  WHERE id = v_sub.id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.apply_hotel_profile_submission(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.apply_hotel_profile_submission(uuid, uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_hotel_profile_submission(p_submission_id uuid, p_reviewer uuid, p_expected_updated_at timestamptz)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$ SELECT app_private.apply_hotel_profile_submission(p_submission_id, p_reviewer, p_expected_updated_at) $$;

REVOKE ALL ON FUNCTION public.apply_hotel_profile_submission(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_hotel_profile_submission(uuid, uuid, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
