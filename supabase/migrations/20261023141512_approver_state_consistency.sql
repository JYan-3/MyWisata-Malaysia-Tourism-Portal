-- Give catalogue reviews one database transaction for state, history, and audit.
-- updated_at is the review snapshot token; vouchers did not previously have one.
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION app_private.set_catalogue_item_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.set_catalogue_item_updated_at() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS outlets_catalogue_updated_at ON public.outlets;
CREATE TRIGGER outlets_catalogue_updated_at
  BEFORE UPDATE ON public.outlets
  FOR EACH ROW EXECUTE FUNCTION app_private.set_catalogue_item_updated_at();

DROP TRIGGER IF EXISTS products_catalogue_updated_at ON public.products;
CREATE TRIGGER products_catalogue_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION app_private.set_catalogue_item_updated_at();

DROP TRIGGER IF EXISTS vouchers_catalogue_updated_at ON public.vouchers;
CREATE TRIGGER vouchers_catalogue_updated_at
  BEFORE UPDATE ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION app_private.set_catalogue_item_updated_at();

CREATE OR REPLACE FUNCTION app_private.review_catalogue_item(
  p_entity_type text,
  p_entity_id uuid,
  p_expected_updated_at timestamptz,
  p_action text,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_table text;
  v_before jsonb;
  v_vendor_id uuid;
  v_review_status text;
  v_entity_status text;
  v_review_id uuid;
  v_reviewed_at timestamptz := clock_timestamp();
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF public.has_staff_permission(v_actor_id, 'admin.catalogue.review') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'catalogue_review_permission_required';
  END IF;
  IF p_entity_type IS NULL OR p_entity_type NOT IN ('outlet', 'product', 'voucher', 'hotel_profile') THEN
    RAISE EXCEPTION 'invalid_entity_type';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'change_requested', 'reject') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF p_action <> 'approve' AND char_length(btrim(coalesce(p_note, ''))) < 10 THEN
    RAISE EXCEPTION 'review_reason_required';
  END IF;
  IF char_length(coalesce(p_note, '')) > 500 THEN RAISE EXCEPTION 'review_reason_too_long'; END IF;
  IF p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'expected_version_required'; END IF;

  v_table := CASE p_entity_type
    WHEN 'outlet' THEN 'outlets'
    WHEN 'product' THEN 'products'
    WHEN 'voucher' THEN 'vouchers'
    ELSE 'hotel_profile_submissions'
  END;

  EXECUTE format('SELECT to_jsonb(item) FROM public.%I item WHERE item.id = $1 FOR UPDATE', v_table)
    INTO v_before USING p_entity_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'catalogue_item_not_found'; END IF;
  IF (v_before->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'catalogue_item_changed';
  END IF;

  IF p_entity_type = 'hotel_profile' THEN
    IF v_before->>'status' <> 'pending_review' THEN RAISE EXCEPTION 'catalogue_item_not_pending'; END IF;
    v_vendor_id := (v_before->>'vendor_id')::uuid;
    v_review_status := CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'change_requested' END;
    v_entity_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END;
    IF p_action = 'approve' THEN
      PERFORM app_private.apply_hotel_profile_submission(p_entity_id, v_actor_id, p_expected_updated_at);
    ELSE
      UPDATE public.hotel_profile_submissions
         SET status = v_entity_status, review_note = nullif(btrim(p_note), ''), reviewed_by = v_actor_id,
             reviewed_at = v_reviewed_at, updated_at = v_reviewed_at
       WHERE id = p_entity_id;
    END IF;
  ELSE
    IF v_before->>'review_status' <> 'pending_review' THEN RAISE EXCEPTION 'catalogue_item_not_pending'; END IF;
    IF p_entity_type = 'voucher' AND v_before->>'vendor_review_status' <> 'approved' THEN
      RAISE EXCEPTION 'voucher_vendor_owner_approval_required';
    END IF;
    v_vendor_id := (v_before->>'vendor_id')::uuid;
    v_review_status := CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'change_requested' END;

    IF p_entity_type = 'voucher' THEN
      UPDATE public.vouchers
         SET review_status = v_review_status, review_note = nullif(btrim(p_note), ''), reviewed_by = v_actor_id,
             reviewed_at = v_reviewed_at, is_active = (p_action = 'approve')
       WHERE id = p_entity_id;
    ELSIF p_entity_type = 'product' THEN
      UPDATE public.products
         SET review_status = v_review_status, review_note = nullif(btrim(p_note), ''), reviewed_by = v_actor_id,
             reviewed_at = v_reviewed_at, status = CASE WHEN p_action = 'approve' THEN 'active' ELSE 'inactive' END
       WHERE id = p_entity_id;
    ELSE
      UPDATE public.outlets
         SET review_status = v_review_status, review_note = nullif(btrim(p_note), ''), reviewed_by = v_actor_id,
             reviewed_at = v_reviewed_at, status = CASE WHEN p_action = 'approve' THEN 'active' ELSE 'inactive' END
       WHERE id = p_entity_id;
    END IF;
  END IF;

  INSERT INTO public.content_reviews(entity_type, entity_id, vendor_id, reviewer_id, action, note)
  VALUES (p_entity_type, p_entity_id, v_vendor_id, v_actor_id, v_review_status, nullif(btrim(p_note), ''))
  RETURNING id INTO v_review_id;

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (
    v_actor_id,
    'content.' || p_action,
    p_entity_type,
    p_entity_id,
    jsonb_build_object('review_status', coalesce(v_before->>'review_status', v_before->>'status')),
    jsonb_build_object('review_status', v_review_status, 'reviewed_at', v_reviewed_at),
    nullif(btrim(p_note), '')
  );

  RETURN jsonb_build_object(
    'reviewId', v_review_id,
    'entityId', p_entity_id,
    'entityType', p_entity_type,
    'status', v_review_status,
    'reviewedBy', v_actor_id,
    'reviewedAt', v_reviewed_at,
    'vendorId', v_vendor_id
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.review_catalogue_item(text,uuid,timestamptz,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.review_catalogue_item(text,uuid,timestamptz,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.review_catalogue_item(
  p_entity_type text,p_entity_id uuid,p_expected_updated_at timestamptz,p_action text,p_note text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT app_private.review_catalogue_item(p_entity_type,p_entity_id,p_expected_updated_at,p_action,p_note);
$$;
REVOKE ALL ON FUNCTION public.review_catalogue_item(text, uuid, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_catalogue_item(text, uuid, timestamptz, text, text) TO authenticated;

-- Service-only, database-paginated union for the four heterogeneous catalogue queues.
CREATE OR REPLACE FUNCTION public.list_catalogue_review_queue(
  p_page integer,
  p_page_size integer,
  p_entity_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offset integer;
  v_result jsonb;
BEGIN
  IF p_page IS NULL OR p_page_size IS NULL OR p_page < 1 OR p_page > 100000 OR p_page_size NOT IN (10, 25, 50) THEN
    RAISE EXCEPTION 'invalid_pagination';
  END IF;
  IF p_entity_type IS NOT NULL AND p_entity_type NOT IN ('outlet', 'product', 'voucher', 'hotel_profile') THEN
    RAISE EXCEPTION 'invalid_entity_type';
  END IF;
  v_offset := (p_page - 1) * p_page_size;

  WITH queue_keys AS MATERIALIZED (
    SELECT o.id, o.created_at, 'outlet'::text AS entity_type
    FROM public.outlets o WHERE o.review_status = 'pending_review'
    UNION ALL
    SELECT p.id, p.created_at, 'product'::text
    FROM public.products p WHERE p.review_status = 'pending_review'
    UNION ALL
    SELECT voucher.id, voucher.created_at, 'voucher'::text
    FROM public.vouchers voucher
    WHERE voucher.review_status = 'pending_review' AND voucher.vendor_review_status = 'approved'
    UNION ALL
    SELECT submission.id, submission.created_at, 'hotel_profile'::text
    FROM public.hotel_profile_submissions submission WHERE submission.status = 'pending_review'
  ), page_keys AS MATERIALIZED (
    SELECT id, created_at, entity_type
    FROM queue_keys
    WHERE p_entity_type IS NULL OR entity_type = p_entity_type
    ORDER BY created_at DESC, id DESC, entity_type ASC
    OFFSET v_offset
    LIMIT p_page_size
  ), page_items AS (
    SELECT jsonb_build_object(
        'id', o.id, 'display_id', o.display_id, 'name', o.name, 'city', o.city, 'state', o.state,
        'review_status', o.review_status, 'review_note', o.review_note, 'created_at', o.created_at,
        'updated_at', o.updated_at, 'vendor_id', o.vendor_id,
        'vendors', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('name', v.name) END,
        'entityType', 'outlet', 'entityLabel', o.name, 'context', concat_ws(', ', o.city, o.state)
      ) AS item, o.id, o.created_at, 'outlet'::text AS entity_type
    FROM page_keys key
    JOIN public.outlets o ON key.id = o.id AND key.entity_type = 'outlet'
    LEFT JOIN public.vendors v ON v.id = o.vendor_id
    UNION ALL
    SELECT jsonb_build_object(
        'id', p.id, 'display_id', p.display_id, 'name', p.name, 'product_type', p.product_type,
        'base_price', p.base_price, 'review_status', p.review_status, 'review_note', p.review_note,
        'created_at', p.created_at, 'updated_at', p.updated_at, 'vendor_id', p.vendor_id,
        'vendors', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('name', v.name) END,
        'outlets', CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('name', o.name, 'city', o.city) END,
        'entityType', 'product', 'entityLabel', p.name,
        'context', coalesce(o.city, o.name, p.product_type)
      ), p.id, p.created_at, 'product'::text
    FROM page_keys key
    JOIN public.products p ON key.id = p.id AND key.entity_type = 'product'
    LEFT JOIN public.vendors v ON v.id = p.vendor_id
    LEFT JOIN public.outlets o ON o.id = p.outlet_id
    UNION ALL
    SELECT jsonb_build_object(
        'id', voucher.id, 'code', voucher.code, 'name', voucher.name,
        'discount_value', voucher.discount_value, 'voucher_type', voucher.voucher_type,
        'review_status', voucher.review_status, 'review_note', voucher.review_note,
        'vendor_review_status', voucher.vendor_review_status, 'created_at', voucher.created_at,
        'updated_at', voucher.updated_at, 'vendor_id', voucher.vendor_id,
        'vendors', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('name', v.name) END,
        'outlets', CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('name', o.name, 'city', o.city) END,
        'entityType', 'voucher', 'entityLabel', voucher.code || ' · ' || voucher.name,
        'context', coalesce(o.city, 'All outlets')
      ), voucher.id, voucher.created_at, 'voucher'::text
    FROM page_keys key
    JOIN public.vouchers voucher ON key.id = voucher.id AND key.entity_type = 'voucher'
    LEFT JOIN public.vendors v ON v.id = voucher.vendor_id
    LEFT JOIN public.outlets o ON o.id = voucher.outlet_id
    UNION ALL
    SELECT jsonb_build_object(
        'id', submission.id, 'created_at', submission.created_at, 'updated_at', submission.updated_at,
        'vendor_id', submission.vendor_id, 'outlet_id', submission.outlet_id,
        'payload', submission.payload, 'review_status', 'pending_review',
        'vendors', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('name', v.name) END,
        'outlets', CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
          'name', o.name, 'city', o.city, 'state', o.state, 'address', o.address, 'phone', o.phone,
          'hotel_about', o.hotel_about, 'amenity_codes', o.amenity_codes,
          'check_in_time', o.check_in_time, 'check_out_time', o.check_out_time, 'stay_policies', o.stay_policies
        ) END,
        'entityType', 'hotel_profile', 'entityLabel', coalesce(o.name, 'Hotel'),
        'context', concat_ws(', ', o.city, o.state), 'live', CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
          'name', o.name, 'city', o.city, 'state', o.state, 'address', o.address, 'phone', o.phone,
          'hotel_about', o.hotel_about, 'amenity_codes', o.amenity_codes,
          'check_in_time', o.check_in_time, 'check_out_time', o.check_out_time, 'stay_policies', o.stay_policies
        ) END,
        'proposed', submission.payload
      ), submission.id, submission.created_at, 'hotel_profile'::text
    FROM page_keys key
    JOIN public.hotel_profile_submissions submission ON key.id = submission.id AND key.entity_type = 'hotel_profile'
    LEFT JOIN public.vendors v ON v.id = submission.vendor_id
    LEFT JOIN public.outlets o ON o.id = submission.outlet_id
  )
  SELECT jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC, id DESC, entity_type ASC) FROM page_items), '[]'::jsonb),
    'total', (SELECT count(*) FROM queue_keys WHERE p_entity_type IS NULL OR entity_type = p_entity_type),
    'totalPages', ceil(((SELECT count(*) FROM queue_keys WHERE p_entity_type IS NULL OR entity_type = p_entity_type)::numeric) / p_page_size)::integer,
    'page', p_page,
    'pageSize', p_page_size,
    'counts', jsonb_build_object(
      'all', (SELECT count(*) FROM queue_keys),
      'outlet', (SELECT count(*) FROM queue_keys WHERE entity_type = 'outlet'),
      'product', (SELECT count(*) FROM queue_keys WHERE entity_type = 'product'),
      'voucher', (SELECT count(*) FROM queue_keys WHERE entity_type = 'voucher'),
      'hotel_profile', (SELECT count(*) FROM queue_keys WHERE entity_type = 'hotel_profile')
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_catalogue_review_queue(integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_catalogue_review_queue(integer, integer, text) TO service_role;

NOTIFY pgrst, 'reload schema';


-- Only the service-backed, permission-gated admin endpoints can list these queues.
-- Search is literal, case-insensitive substring matching, matching the existing UI.
CREATE OR REPLACE FUNCTION public.list_staff_review_queue(
  p_domain text, p_page integer, p_page_size integer, p_status text, p_search text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_domain NOT IN ('registrations', 'promotions', 'refunds')
    OR p_page IS NULL OR p_page < 1 OR p_page > 100000
    OR p_page_size IS NULL
    OR (p_domain = 'refunds' AND p_page_size NOT IN (15,25,50))
    OR (p_domain <> 'refunds' AND p_page_size NOT IN (10,25,50))
    OR char_length(coalesce(p_search,'')) > 200 THEN
    RAISE EXCEPTION 'invalid_queue_filters';
  END IF;
  WITH queue AS MATERIALIZED (
    SELECT r.id, r.status::text, r.created_at, 0::numeric AS amount,
      lower(concat_ws(' ',v.name,c.title,l.name,r.stall_number,r.requested_stall_number)) AS search_text
    FROM public.promotion_campaign_vendors r
    LEFT JOIN public.vendors v ON v.id=r.vendor_id
    LEFT JOIN public.promotion_campaigns c ON c.id=r.campaign_id
    LEFT JOIN public.promotion_campaign_locations l ON l.id=r.event_location_id
    WHERE p_domain='registrations'
    UNION ALL
    SELECT r.id,r.status::text,r.created_at,0::numeric,lower(concat_ws(' ',r.title,v.name))
    FROM public.vendor_event_promotions r LEFT JOIN public.vendors v ON v.id=r.vendor_id
    WHERE p_domain='promotions'
    UNION ALL
    SELECT r.id,r.status::text,r.created_at,r.amount::numeric,
      lower(concat_ws(' ',o.display_id,r.order_id,p.provider,r.reason))
    FROM public.refunds r LEFT JOIN public.orders o ON o.id=r.order_id
    LEFT JOIN public.payments p ON p.id=r.payment_id
    WHERE p_domain='refunds'
  ), filtered AS MATERIALIZED (
    SELECT * FROM queue WHERE (p_status IS NULL OR status=p_status)
      AND strpos(search_text,lower(btrim(coalesce(p_search,'')))) > 0
  ), meta AS (
    SELECT count(*) AS total, ceil(count(*)::numeric/p_page_size)::integer AS pages,
      least(p_page,greatest(1,ceil(count(*)::numeric/p_page_size)::integer)) AS page
    FROM filtered
  ), page_keys AS MATERIALIZED (
    SELECT id,status,created_at FROM filtered ORDER BY created_at DESC,id DESC
    LIMIT p_page_size OFFSET (SELECT (page-1)*p_page_size FROM meta)
  ), items AS (
    SELECT k.created_at,k.id,jsonb_build_object('id',r.id,'campaignId',r.campaign_id,
      'campaignTitle',c.title,'locationName',l.name,'vendorId',r.vendor_id,'vendorName',v.name,
      'stallNumber',r.stall_number,'requestedStallNumber',r.requested_stall_number,
      'status',r.status,'createdAt',r.created_at) AS item
    FROM page_keys k JOIN public.promotion_campaign_vendors r ON r.id=k.id
    LEFT JOIN public.vendors v ON v.id=r.vendor_id
    LEFT JOIN public.promotion_campaigns c ON c.id=r.campaign_id
    LEFT JOIN public.promotion_campaign_locations l ON l.id=r.event_location_id
    WHERE p_domain='registrations'
    UNION ALL
    SELECT k.created_at,k.id,jsonb_build_object('id',r.id,'vendorId',r.vendor_id,'vendorName',v.name,
      'title',r.title,'startDate',r.starts_on,'endDate',r.ends_on,'status',r.status,'createdAt',r.created_at)
    FROM page_keys k JOIN public.vendor_event_promotions r ON r.id=k.id
    LEFT JOIN public.vendors v ON v.id=r.vendor_id WHERE p_domain='promotions'
    UNION ALL
    SELECT k.created_at,k.id,jsonb_build_object('id',k.id) FROM page_keys k WHERE p_domain='refunds'
  )
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,id DESC) FROM items),'[]'::jsonb),
    'total',m.total,'totalPages',m.pages,'page',m.page,'pageSize',p_page_size,
    'counts',coalesce((SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*) AS n FROM queue GROUP BY status) c),'{}'::jsonb)
      || jsonb_build_object('all',(SELECT count(*) FROM queue)),
    'summary',jsonb_build_object(
      'pendingCount',(SELECT count(*) FROM filtered WHERE status IN ('pending','approved')),
      'pendingValue',(SELECT coalesce(sum(amount),0) FROM filtered WHERE status IN ('pending','approved')),
      'processedCount',(SELECT count(*) FROM filtered WHERE status='processed'),
      'failedCount',(SELECT count(*) FROM filtered WHERE status='failed'),
      'oldestCreatedAt',(SELECT min(created_at) FROM filtered))) INTO v_result FROM meta m;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.list_staff_review_queue(text,integer,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff_review_queue(text,integer,integer,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';


CREATE OR REPLACE FUNCTION app_private.read_staff_review_assignment(p_domain text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); s public.kyc_submissions%ROWTYPE; r public.vendor_recommendations%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_domain='kyc' THEN
    PERFORM app_private.require_kyc_operations_reviewer();
    SELECT * INTO s FROM public.kyc_submissions WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'kyc_not_found'; END IF;
    RETURN jsonb_build_object('assignedTo',s.assigned_to,'claimedAt',s.claimed_at,'reviewVersion',s.review_version,
      'isAssignedToActor',coalesce(s.assigned_to=actor,false),'canDecide',coalesce(s.status='pending' AND s.user_id<>actor
      AND (s.assigned_to=actor OR app_private.is_kyc_review_super_admin()),false));
  ELSIF p_domain='recommendation' THEN
    IF NOT public.can_review_recommendation(actor) THEN RAISE EXCEPTION 'recommendation_reviewer_required'; END IF;
    SELECT * INTO r FROM public.vendor_recommendations WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'recommendation_not_found'; END IF;
    RETURN jsonb_build_object('assignedTo',r.assigned_to,'claimedAt',r.claimed_at,
      'isAssignedToActor',coalesce(r.assigned_to=actor,false),'canDecide',coalesce(r.status='pending'
      AND (r.assigned_to=actor OR public.is_super_admin(actor)),false));
  END IF;
  RAISE EXCEPTION 'invalid_review_domain';
END; $$;
REVOKE ALL ON FUNCTION app_private.read_staff_review_assignment(text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.read_staff_review_assignment(text,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.read_staff_review_assignment(p_domain text,p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT app_private.read_staff_review_assignment(p_domain,p_id);
$$;
REVOKE ALL ON FUNCTION public.read_staff_review_assignment(text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_staff_review_assignment(text,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- Preserve current event transactions; align their authorization with Access Control.
CREATE OR REPLACE FUNCTION app_private.review_vendor_event_promotion(p_promotion_id uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from_status TEXT;
  v_to_status TEXT;
  v_starts_on DATE;
  v_ends_on DATE;
  v_max_concurrent INT;
  v_max_overlap INT;
BEGIN
  IF public.has_staff_permission(auth.uid(), 'admin.event_promotion.review') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF p_action NOT IN ('approve', 'reject', 'request_changes') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF p_action IN ('reject', 'request_changes') AND char_length(BTRIM(COALESCE(p_note, ''))) < 10 THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  SELECT status, starts_on, ends_on INTO v_from_status, v_starts_on, v_ends_on
    FROM public.vendor_event_promotions
   WHERE id = p_promotion_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_from_status != 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  IF p_action = 'approve' THEN
    PERFORM pg_advisory_xact_lock(hashtext('event_promotion_capacity'));

    SELECT COALESCE(value::INT, 4) INTO v_max_concurrent
      FROM public.platform_settings WHERE key = 'event_promotion.max_concurrent';
    v_max_concurrent := COALESCE(v_max_concurrent, 4);

    SELECT COALESCE(MAX(day_count), 0) INTO v_max_overlap
      FROM (
        SELECT COUNT(*) AS day_count
          FROM generate_series(v_starts_on, v_ends_on, interval '1 day') AS d(day)
          JOIN public.vendor_event_promotions p2
            ON p2.id <> p_promotion_id
           AND p2.status IN ('approved', 'paid')
           AND p2.starts_on <= d.day::date
           AND p2.ends_on >= d.day::date
         GROUP BY d.day
      ) counts;

    IF v_max_overlap >= v_max_concurrent THEN
      RAISE EXCEPTION 'capacity_exceeded';
    END IF;
  END IF;

  v_to_status := CASE p_action
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
    ELSE 'changes_requested'
  END;

  UPDATE public.vendor_event_promotions
     SET status = v_to_status,
         reviewer_id = auth.uid(),
         reviewed_at = now(),
         rejection_reason = CASE WHEN p_action = 'reject' THEN BTRIM(p_note) ELSE NULL END,
         changes_requested_at = CASE WHEN p_action = 'request_changes' THEN now() ELSE NULL END,
         changes_requested_reason = CASE WHEN p_action = 'request_changes' THEN BTRIM(p_note) ELSE NULL END,
         updated_at = now()
   WHERE id = p_promotion_id;

  INSERT INTO public.vendor_event_promotion_review_events
    (promotion_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_promotion_id, v_from_status, v_to_status, p_action, auth.uid(), 'admin', p_note);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.set_vendor_event_promotion_visibility(p_promotion_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from_status TEXT;
  v_starts_on DATE;
  v_ends_on DATE;
  v_to_status TEXT;
  v_max_concurrent INT;
  v_max_overlap INT;
BEGIN
  IF public.has_staff_permission(auth.uid(), 'admin.event_promotion.review') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF p_action NOT IN ('pause', 'resume') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT status, starts_on, ends_on INTO v_from_status, v_starts_on, v_ends_on
    FROM public.vendor_event_promotions
   WHERE id = p_promotion_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF p_action = 'pause' THEN
    IF v_from_status != 'paid' THEN RAISE EXCEPTION 'not_paid'; END IF;
    v_to_status := 'paused';
  ELSE
    IF v_from_status != 'paused' THEN RAISE EXCEPTION 'not_paused'; END IF;
    IF v_ends_on < CURRENT_DATE THEN RAISE EXCEPTION 'promotion_ended'; END IF;

    PERFORM pg_advisory_xact_lock(hashtext('event_promotion_capacity'));

    SELECT COALESCE(value::INT, 4) INTO v_max_concurrent
      FROM public.platform_settings WHERE key = 'event_promotion.max_concurrent';
    v_max_concurrent := COALESCE(v_max_concurrent, 4);

    SELECT COALESCE(MAX(day_count), 0) INTO v_max_overlap
      FROM (
        SELECT COUNT(*) AS day_count
          FROM generate_series(v_starts_on, v_ends_on, interval '1 day') AS d(day)
          JOIN public.vendor_event_promotions p2
            ON p2.id <> p_promotion_id
           AND p2.status IN ('approved', 'paid')
           AND p2.starts_on <= d.day::date
           AND p2.ends_on >= d.day::date
         GROUP BY d.day
      ) counts;

    IF v_max_overlap >= v_max_concurrent THEN
      RAISE EXCEPTION 'capacity_exceeded';
    END IF;

    v_to_status := 'paid';
  END IF;

  UPDATE public.vendor_event_promotions
     SET status = v_to_status,
         updated_at = now()
   WHERE id = p_promotion_id;

  INSERT INTO public.vendor_event_promotion_review_events
    (promotion_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_promotion_id, v_from_status, v_to_status, p_action, auth.uid(), 'admin', NULL);
END;
$function$;


REVOKE ALL ON FUNCTION app_private.review_vendor_event_promotion(uuid,text,text),app_private.set_vendor_event_promotion_visibility(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.review_vendor_event_promotion(uuid,text,text),app_private.set_vendor_event_promotion_visibility(uuid,text) TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';
