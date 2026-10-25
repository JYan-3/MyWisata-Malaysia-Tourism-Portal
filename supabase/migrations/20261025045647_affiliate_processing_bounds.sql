-- Keep the admin fraud queue bounded at the database boundary while
-- preserving filtered counts and stable ordering.
CREATE OR REPLACE FUNCTION public.get_affiliate_fraud_flag_page(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 10,
  p_flag_type text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_status text DEFAULT 'open',
  p_search text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_search text := trim(COALESCE(p_search, ''));
  v_total bigint;
  v_items jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 1000000
    OR p_page_size NOT IN (10, 25, 50)
    OR (p_flag_type IS NOT NULL AND p_flag_type NOT IN (
      'self_referral','duplicate_attribution','expired_attribution','click_velocity',
      'zero_conversion','visitor_clustering','click_cap_reached','vendor_ineligible','link_disabled_at_payout'
    ))
    OR (p_severity IS NOT NULL AND p_severity NOT IN ('low','medium','high'))
    OR (p_status IS NOT NULL AND p_status NOT IN ('open','reviewed','dismissed'))
    OR length(v_search) > 200 THEN
    RAISE EXCEPTION 'affiliate_flag_page_input_invalid';
  END IF;

  WITH filtered AS (
    SELECT f.id, f.link_id, f.user_id, f.order_id, f.flag_type, f.severity,
      f.detail, f.status, f.created_at, f.reviewed_at,
      COALESCE(u.full_name, u.email, 'Unknown user') AS user_name,
      l.affiliate_code
    FROM public.affiliate_fraud_flags f
    LEFT JOIN public.users u ON u.id = f.user_id
    LEFT JOIN public.affiliate_links l ON l.id = f.link_id
    WHERE (p_flag_type IS NULL OR f.flag_type = p_flag_type)
      AND (p_severity IS NULL OR f.severity = p_severity)
      AND (p_status IS NULL OR f.status = p_status)
      AND (v_search = '' OR (
        COALESCE(u.full_name, '') ILIKE '%' || replace(replace(v_search, '%', ''), '_', '') || '%'
        OR COALESCE(u.email, '') ILIKE '%' || replace(replace(v_search, '%', ''), '_', '') || '%'
        OR COALESCE(l.affiliate_code, '') ILIKE '%' || replace(replace(v_search, '%', ''), '_', '') || '%'
        OR f.order_id::text ILIKE '%' || replace(replace(v_search, '%', ''), '_', '') || '%'
        OR f.flag_type ILIKE '%' || replace(replace(v_search, '%', ''), '_', '') || '%'
      ))
  ), counted AS (
    SELECT count(*) AS total FROM filtered
  ), page_rows AS (
    SELECT * FROM filtered
    ORDER BY created_at DESC, id DESC
    LIMIT p_page_size OFFSET (p_page - 1) * p_page_size
  )
  SELECT counted.total,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'link_id', r.link_id, 'user_id', r.user_id, 'order_id', r.order_id,
      'flag_type', r.flag_type, 'severity', r.severity, 'detail', r.detail,
      'status', r.status, 'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
      'user_name', r.user_name, 'affiliate_code', r.affiliate_code
    ) ORDER BY r.created_at DESC, r.id DESC) FROM page_rows r), '[]'::jsonb)
  INTO v_total, v_items FROM counted;

  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'page', p_page, 'page_size', p_page_size);
END;
$$;

REVOKE ALL ON FUNCTION public.get_affiliate_fraud_flag_page(integer,integer,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_fraud_flag_page(integer,integer,text,text,text,text) TO service_role;

-- Tier inputs are aggregated in SQL across the owner's links, rather than
-- materializing click ids and confirmed orders in the application process.
CREATE OR REPLACE FUNCTION app_private.affiliate_tier_signals(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'affiliate_user_required'; END IF;

  WITH owner_links AS (
    SELECT id FROM public.affiliate_links WHERE user_id = p_user_id
  ), click_totals AS (
    SELECT count(*) AS click_count FROM public.affiliate_clicks c JOIN owner_links l ON l.id = c.link_id
  ), flagged AS (
    SELECT count(*) AS flag_count
    FROM public.affiliate_fraud_flags f
    JOIN owner_links l ON l.id = f.link_id
    WHERE f.status <> 'dismissed'
      AND f.flag_type NOT IN ('self_referral','expired_attribution')
  ), confirmed AS (
    SELECT count(*) AS referral_count,
      COALESCE(sum(round(o.total_amount * 100)::bigint), 0) AS sales_amount_sen,
      max(a.created_at) AS last_confirmed_at
    FROM public.affiliate_attributions a
    JOIN public.affiliate_clicks c ON c.id = a.click_id
    JOIN owner_links l ON l.id = c.link_id
    LEFT JOIN public.orders o ON o.id = a.order_id
    WHERE a.status = 'confirmed'
  )
  SELECT jsonb_build_object(
    'click_count', click_totals.click_count,
    'flag_count', flagged.flag_count,
    'referral_count', confirmed.referral_count,
    'sales_amount_sen', confirmed.sales_amount_sen,
    'last_confirmed_at', confirmed.last_confirmed_at
  ) INTO v_result FROM click_totals, flagged, confirmed;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.affiliate_tier_signals(p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.affiliate_tier_signals(p_user_id);
$$;
REVOKE ALL ON FUNCTION app_private.affiliate_tier_signals(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.affiliate_tier_signals(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_tier_signals(uuid) TO service_role;

-- Persistent per-scope keyset checkpoints for bounded affiliate jobs. A
-- crashed worker replays its last uncommitted batch; successful batches move
-- the cursor. An incomplete pass starts over only after reaching its cutoff.
CREATE TABLE IF NOT EXISTS app_private.affiliate_job_progress (
  scope text PRIMARY KEY CHECK (scope IN ('clearing','clearing_force','fraud_sweep')),
  cutoff timestamptz NOT NULL,
  cursor_created_at timestamptz,
  cursor_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.affiliate_job_progress FROM PUBLIC, anon, authenticated, service_role;

-- These support the exact keyset/foreign-key lookups used by the bounded
-- scans and list. No speculative indexes on unrelated analytics paths.
CREATE INDEX IF NOT EXISTS affiliate_attributions_pending_created_id_idx
  ON public.affiliate_attributions(status, created_at, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS affiliate_clicks_link_created_idx
  ON public.affiliate_clicks(link_id, created_at, id);
CREATE INDEX IF NOT EXISTS affiliate_attributions_click_status_idx
  ON public.affiliate_attributions(click_id, status);
CREATE INDEX IF NOT EXISTS affiliate_fraud_flags_status_created_id_idx
  ON public.affiliate_fraud_flags(status, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.claim_affiliate_job(p_scope text, p_cutoff timestamptz, p_lease_seconds integer DEFAULT 600)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job app_private.affiliate_job_progress%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('clearing','clearing_force','fraud_sweep') OR p_cutoff IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION 'affiliate_job_input_invalid';
  END IF;

  INSERT INTO app_private.affiliate_job_progress(scope, cutoff)
  VALUES(p_scope, p_cutoff) ON CONFLICT(scope) DO NOTHING;
  SELECT * INTO v_job FROM app_private.affiliate_job_progress WHERE scope = p_scope FOR UPDATE;
  IF v_job.lease_expires_at > now() THEN RETURN jsonb_build_object('outcome','busy'); END IF;

  IF v_job.lease_expires_at IS NULL AND v_job.cursor_created_at IS NULL AND v_job.cursor_id IS NULL THEN
    UPDATE app_private.affiliate_job_progress SET cutoff = p_cutoff WHERE scope = p_scope RETURNING * INTO v_job;
  END IF;
  UPDATE app_private.affiliate_job_progress SET lease_token = v_token,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  WHERE scope = p_scope RETURNING * INTO v_job;
  RETURN jsonb_build_object('outcome','claimed','token',v_token,'cutoff',v_job.cutoff,
    'cursor_created_at',v_job.cursor_created_at,'cursor_id',v_job.cursor_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_affiliate_pending_clear_batch(p_scope text, p_token uuid, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job app_private.affiliate_job_progress%ROWTYPE; v_rows jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_scope NOT IN ('clearing','clearing_force','fraud_sweep') OR p_token IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'affiliate_job_input_invalid'; END IF;
  SELECT * INTO v_job FROM app_private.affiliate_job_progress WHERE scope=p_scope AND lease_token=p_token AND lease_expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'affiliate_job_lease_stale'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',q.id,'click_id',q.click_id,'order_id',q.order_id,
    'commission_amount',q.commission_amount,'created_at',q.created_at) ORDER BY q.created_at,q.id),'[]'::jsonb)
  INTO v_rows FROM (
    SELECT a.id,a.click_id,a.order_id,a.commission_amount,a.created_at
    FROM public.affiliate_attributions a
    WHERE p_scope IN ('clearing','clearing_force') AND a.status='pending' AND a.created_at < v_job.cutoff
      AND (v_job.cursor_created_at IS NULL OR (a.created_at,a.id) > (v_job.cursor_created_at,v_job.cursor_id))
    ORDER BY a.created_at,a.id LIMIT p_limit
  ) q;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_affiliate_fraud_sweep_batch(
  p_token uuid,p_velocity_cutoff timestamptz,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job app_private.affiliate_job_progress%ROWTYPE; v_rows jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_token IS NULL OR p_velocity_cutoff IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'affiliate_job_input_invalid'; END IF;
  SELECT * INTO v_job FROM app_private.affiliate_job_progress WHERE scope='fraud_sweep' AND lease_token=p_token AND lease_expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'affiliate_job_lease_stale'; END IF;
  WITH link_page AS (
    SELECT l.id,l.user_id,l.is_active,l.created_at
    FROM public.affiliate_links l
    WHERE l.created_at <= v_job.cutoff
      AND (v_job.cursor_created_at IS NULL OR (l.created_at,l.id) > (v_job.cursor_created_at,v_job.cursor_id))
    ORDER BY l.created_at,l.id LIMIT p_limit
  ), stats AS (
    SELECT l.id,l.user_id,l.is_active,l.created_at,
      COALESCE(clicks.total_clicks,0) AS total_clicks,
      COALESCE(clicks.recent_clicks,0) AS recent_clicks,
      COALESCE(visitors.top_visitor_count,0) AS top_visitor_count,
      COALESCE(referrals.has_referral,false) AS has_referral,
      CASE WHEN EXISTS (SELECT 1 FROM public.vendors v WHERE v.owner_id=l.user_id AND v.status IN ('pending','approved','suspended')) THEN 'vendor_owner'
        WHEN EXISTS (SELECT 1 FROM public.outlet_managers om WHERE om.user_id=l.user_id) THEN 'outlet_manager' END AS ineligible_role
    FROM link_page l
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_clicks,count(*) FILTER (WHERE c.created_at >= p_velocity_cutoff) AS recent_clicks
      FROM public.affiliate_clicks c WHERE c.link_id=l.id AND c.created_at <= v_job.cutoff
    ) clicks ON true
    LEFT JOIN LATERAL (
      SELECT max(visitor_counts.visitor_count) AS top_visitor_count FROM (
        SELECT count(*) AS visitor_count FROM public.affiliate_clicks c
        WHERE c.link_id=l.id AND c.created_at <= v_job.cutoff AND c.ip_hash IS NOT NULL
        GROUP BY c.ip_hash
      ) visitor_counts
    ) visitors ON true
    LEFT JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM public.affiliate_clicks c JOIN public.affiliate_attributions a ON a.click_id=c.id
        WHERE c.link_id=l.id AND c.created_at <= v_job.cutoff
      ) AS has_referral
    ) referrals ON true
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'user_id',s.user_id,'is_active',s.is_active,
    'created_at',s.created_at,'total_clicks',s.total_clicks,'recent_clicks',s.recent_clicks,
    'top_visitor_count',s.top_visitor_count,'has_referral',s.has_referral,'ineligible_role',s.ineligible_role)
    ORDER BY s.created_at,s.id),'[]'::jsonb)
  INTO v_rows FROM stats s;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_affiliate_job(p_scope text,p_token uuid,p_created_at timestamptz,p_id uuid,p_complete boolean,p_release_lease boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_scope NOT IN ('clearing','clearing_force','fraud_sweep') OR p_token IS NULL OR p_complete IS NULL OR p_release_lease IS NULL
    OR (NOT p_complete AND (p_created_at IS NULL OR p_id IS NULL)) THEN RAISE EXCEPTION 'affiliate_job_input_invalid'; END IF;
  UPDATE app_private.affiliate_job_progress SET
    cursor_created_at = CASE WHEN p_complete THEN NULL ELSE p_created_at END,
    cursor_id = CASE WHEN p_complete THEN NULL ELSE p_id END,
    cutoff = CASE WHEN p_complete THEN now() ELSE cutoff END,
    lease_token = CASE WHEN p_release_lease THEN NULL ELSE lease_token END,
    lease_expires_at = CASE WHEN p_release_lease THEN NULL ELSE lease_expires_at END,
    updated_at = now()
  WHERE scope=p_scope AND lease_token=p_token AND lease_expires_at > now();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_affiliate_job(text,timestamptz,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_affiliate_pending_clear_batch(text,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_affiliate_fraud_sweep_batch(uuid,timestamptz,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.advance_affiliate_job(text,uuid,timestamptz,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_affiliate_job(text,timestamptz,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_affiliate_pending_clear_batch(text,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_affiliate_fraud_sweep_batch(uuid,timestamptz,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.log_affiliate_sweep_flag(
  p_link_id uuid,p_user_id uuid,p_flag_type text,p_severity text,p_detail jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_link_id IS NULL OR p_user_id IS NULL
    OR p_flag_type NOT IN ('click_velocity','visitor_clustering','zero_conversion','vendor_ineligible')
    OR p_severity NOT IN ('low','medium','high') OR p_detail IS NULL THEN
    RAISE EXCEPTION 'affiliate_sweep_flag_input_invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_link_id::text || ':' || p_flag_type,0));
  IF EXISTS (SELECT 1 FROM public.affiliate_fraud_flags f WHERE f.link_id=p_link_id
    AND f.flag_type=p_flag_type AND f.status='open' AND f.created_at >= now()-interval '24 hours') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.affiliate_fraud_flags(link_id,user_id,flag_type,severity,detail)
  VALUES(p_link_id,p_user_id,p_flag_type,p_severity,p_detail) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.log_affiliate_sweep_flag(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.log_affiliate_sweep_flag(uuid,uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_affiliate_job(text,uuid,timestamptz,uuid,boolean,boolean) TO service_role;
