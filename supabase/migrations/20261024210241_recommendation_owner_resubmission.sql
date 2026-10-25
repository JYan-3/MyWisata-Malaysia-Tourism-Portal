ALTER TABLE public.vendor_recommendations ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION app_private.bump_recommendation_version() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := greatest(clock_timestamp(),OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.bump_recommendation_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER recommendation_version BEFORE UPDATE ON public.vendor_recommendations
FOR EACH ROW EXECUTE FUNCTION app_private.bump_recommendation_version();
ALTER TABLE public.recommendation_review_events DROP CONSTRAINT recommendation_review_events_action_check;
ALTER TABLE public.recommendation_review_events ADD CONSTRAINT recommendation_review_events_action_check
CHECK(action IN ('approve','reject','request_changes','resubmit'));

CREATE FUNCTION app_private.resubmit_recommendation(p_id uuid,p_expected_updated_at timestamptz,p_data jsonb,p_retained_image_ids uuid[],p_staged_image_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.vendor_recommendations%ROWTYPE; actor uuid := auth.uid(); all_ids uuid[]; image_count integer;
  lat double precision; lng double precision; category uuid; version timestamptz;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF public.customer_can_submit_recommendation(actor) IS DISTINCT FROM true THEN RAISE EXCEPTION 'profile_or_kyc_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('rec_submit:' || actor::text));
  SELECT * INTO r FROM public.vendor_recommendations WHERE id=p_id AND recommender_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'recommendation_not_found'; END IF;
  IF p_expected_updated_at IS NULL OR r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'recommendation_changed'; END IF;
  IF r.status <> 'changes_requested' OR r.converted_vendor_id IS NOT NULL THEN RAISE EXCEPTION 'recommendation_not_editable'; END IF;
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR p_data->>'imageAttested' IS DISTINCT FROM 'true'
    OR char_length(btrim(coalesce(p_data->>'vendorName',''))) NOT BETWEEN 3 AND 255
    OR char_length(btrim(coalesce(p_data->>'description',''))) NOT BETWEEN 20 AND 2000
    OR char_length(btrim(coalesce(p_data->>'whyRecommend',''))) NOT BETWEEN 20 AND 500
    OR char_length(btrim(coalesce(p_data#>>'{location,name}',''))) NOT BETWEEN 2 AND 255
    OR char_length(btrim(coalesce(p_data#>>'{location,formattedAddress}',''))) NOT BETWEEN 5 AND 500
    OR char_length(coalesce(p_data#>>'{location,placeId}',''))>255
    OR char_length(coalesce(p_data#>>'{contact,phone}',''))>50
    OR char_length(coalesce(p_data#>>'{contact,email}',''))>254
    OR char_length(coalesce(p_data#>>'{contact,website}',''))>500
    OR coalesce(nullif(btrim(p_data#>>'{contact,phone}'),''),nullif(btrim(p_data#>>'{contact,email}'),''),nullif(btrim(p_data#>>'{contact,website}'),'')) IS NULL
  THEN RAISE EXCEPTION 'recommendation_invalid'; END IF;
  lat := (p_data#>>'{location,latitude}')::double precision;
  lng := (p_data#>>'{location,longitude}')::double precision;
  category := (p_data->>'categoryId')::uuid;
  IF lat IS NULL OR lng IS NULL OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180
    OR NOT EXISTS(SELECT 1 FROM public.categories WHERE id=category AND is_active)
  THEN RAISE EXCEPTION 'recommendation_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM public.vendor_recommendations WHERE recommender_id=actor AND id<>p_id
    AND vendor_name_normalized=lower(btrim(p_data->>'vendorName')) AND status<>'rejected') THEN RAISE EXCEPTION 'duplicate'; END IF;
  IF (SELECT count(*) FROM public.vendor_recommendations WHERE recommender_id=actor AND id<>p_id AND created_at>now()-interval '24 hours')>=5
    OR (SELECT count(*) FROM public.recommendation_review_events WHERE recommender_id=actor AND action='resubmit' AND created_at>now()-interval '24 hours')>=5
  THEN RAISE EXCEPTION 'rate_limited'; END IF;
  p_retained_image_ids := coalesce(p_retained_image_ids,'{}');
  p_staged_image_ids := coalesce(p_staged_image_ids,'{}');
  all_ids := p_retained_image_ids || p_staged_image_ids;
  image_count := cardinality(all_ids);
  IF image_count NOT BETWEEN 1 AND 5 OR (SELECT count(DISTINCT i) FROM unnest(all_ids) i)<>image_count THEN RAISE EXCEPTION 'staged_images_invalid'; END IF;
  PERFORM id FROM public.recommendation_images WHERE id=ANY(all_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.recommendation_images WHERE id=ANY(p_retained_image_ids) AND recommendation_id=p_id AND owner_id=actor AND NOT is_staged AND removed_at IS NULL AND upload_completed)<>cardinality(p_retained_image_ids)
    OR (SELECT count(*) FROM public.recommendation_images WHERE id=ANY(p_staged_image_ids) AND recommendation_id IS NULL AND owner_id=actor AND is_staged AND removed_at IS NULL AND upload_completed AND created_at>now()-interval '24 hours')<>cardinality(p_staged_image_ids)
  THEN RAISE EXCEPTION 'staged_images_invalid'; END IF;
  UPDATE public.recommendation_images SET removed_at=now(),removed_by=actor
    WHERE recommendation_id=p_id AND NOT is_staged AND removed_at IS NULL AND NOT(id=ANY(p_retained_image_ids));
  UPDATE public.recommendation_images i SET sort_order=chosen.ordinality-1
    FROM unnest(p_retained_image_ids) WITH ORDINALITY chosen(id,ordinality) WHERE i.id=chosen.id;
  UPDATE public.recommendation_images i SET recommendation_id=p_id,is_staged=false,sort_order=cardinality(p_retained_image_ids)+chosen.ordinality-1
    FROM unnest(p_staged_image_ids) WITH ORDINALITY chosen(id,ordinality) WHERE i.id=chosen.id;
  UPDATE public.vendor_recommendations SET vendor_name=btrim(p_data->>'vendorName'),vendor_name_normalized=lower(btrim(p_data->>'vendorName')),
    description=btrim(p_data->>'description'),why_recommend=btrim(p_data->>'whyRecommend'),category_id=category,
    vendor_address=btrim(p_data#>>'{location,formattedAddress}'),google_place_id=nullif(btrim(p_data#>>'{location,placeId}'),''),
    location_name=btrim(p_data#>>'{location,name}'),formatted_address=btrim(p_data#>>'{location,formattedAddress}'),latitude=lat,longitude=lng,
    contact_phone=nullif(btrim(p_data#>>'{contact,phone}'),''),contact_email=nullif(btrim(p_data#>>'{contact,email}'),''),contact_website=nullif(btrim(p_data#>>'{contact,website}'),''),
    image_attested_at=now(),status='pending',assigned_to=NULL,claimed_at=NULL,reviewer_id=NULL,reviewed_at=NULL,
    rejection_reason=NULL,changes_requested_at=NULL,changes_requested_reason=NULL,suggested_place_id=NULL,resolved_place_id=NULL,place_resolution_status='unresolved'
    WHERE id=p_id RETURNING updated_at INTO version;
  INSERT INTO public.recommendation_review_events(recommendation_id,recommender_id,from_status,to_status,action,actor_id,actor_role,customer_message)
    VALUES(p_id,actor,'changes_requested','pending','resubmit',actor,'customer','Recommendation details updated and resubmitted.');
  RETURN jsonb_build_object('id',p_id,'status','pending','version',version);
END; $$;
REVOKE ALL ON FUNCTION app_private.resubmit_recommendation(uuid,timestamptz,jsonb,uuid[],uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.resubmit_recommendation(uuid,timestamptz,jsonb,uuid[],uuid[]) TO authenticated;
CREATE FUNCTION public.resubmit_recommendation(p_id uuid,p_expected_updated_at timestamptz,p_data jsonb,p_retained_image_ids uuid[],p_staged_image_ids uuid[])
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_private.resubmit_recommendation($1,$2,$3,$4,$5);
$$;
REVOKE ALL ON FUNCTION public.resubmit_recommendation(uuid,timestamptz,jsonb,uuid[],uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.resubmit_recommendation(uuid,timestamptz,jsonb,uuid[],uuid[]) TO authenticated;

-- Preserve the existing reviewed transaction. Only remove its legacy-role-only
-- history fallback after confirming its capability check is still present.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('app_private.admin_review_recommendation(uuid,text,text,text)'::regprocedure) INTO definition;
  IF position('IF NOT public.can_review_recommendation(auth.uid()) THEN' IN definition)=0
    OR position('IF v_actor_role IS NULL THEN RAISE EXCEPTION ''admin_required''; END IF;' IN definition)=0
    OR position('''recommendation_decision:'' || p_rec_id::text || '':'' || v_status' IN definition)=0
  THEN RAISE EXCEPTION 'recommendation_review_source_preflight_required'; END IF;
  definition := replace(definition,'IF v_actor_role IS NULL THEN RAISE EXCEPTION ''admin_required''; END IF;','v_actor_role := coalesce(v_actor_role, ''staff'');');
  definition := replace(definition,'''recommendation_decision:'' || p_rec_id::text || '':'' || v_status',
    '''recommendation_decision:'' || p_rec_id::text || '':'' || v_status || '':'' || v_recommendation.updated_at::text');
  EXECUTE definition;
END;
$migration$;
REVOKE ALL ON FUNCTION app_private.admin_review_recommendation(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.admin_review_recommendation(p_rec_id uuid,p_action text,p_internal_note text DEFAULT NULL,p_customer_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'expected_version_required'; END; $$;
CREATE FUNCTION app_private.admin_review_recommendation_versioned(p_rec_id uuid,p_expected_updated_at timestamptz,p_action text,p_internal_note text DEFAULT NULL,p_customer_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.vendor_recommendations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.can_review_recommendation(auth.uid()) IS DISTINCT FROM true THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT * INTO r FROM public.vendor_recommendations WHERE id=p_rec_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'recommendation_not_found'; END IF;
  IF p_expected_updated_at IS NULL OR r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'recommendation_changed'; END IF;
  RETURN app_private.admin_review_recommendation(p_rec_id,p_action,p_internal_note,p_customer_message);
END; $$;
REVOKE ALL ON FUNCTION app_private.admin_review_recommendation_versioned(uuid,timestamptz,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_review_recommendation_versioned(uuid,timestamptz,text,text,text) TO authenticated;
CREATE FUNCTION public.admin_review_recommendation_versioned(p_rec_id uuid,p_expected_updated_at timestamptz,p_action text,p_internal_note text DEFAULT NULL,p_customer_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.admin_review_recommendation_versioned($1,$2,$3,$4,$5); $$;
REVOKE ALL ON FUNCTION public.admin_review_recommendation_versioned(uuid,timestamptz,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_recommendation_versioned(uuid,timestamptz,text,text,text) TO authenticated;
-- Ownership reads stay available. Customers cannot bypass the versioned RPC by UPDATE.
REVOKE UPDATE ON public.vendor_recommendations FROM anon,authenticated;
NOTIFY pgrst,'reload schema';
