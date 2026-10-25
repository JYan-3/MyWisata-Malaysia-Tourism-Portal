-- Do not return or search raw email addresses in the admin fraud queue.

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
      COALESCE(NULLIF(trim(u.full_name), ''), 'Unknown user') AS user_name,
      l.affiliate_code
    FROM public.affiliate_fraud_flags f
    LEFT JOIN public.users u ON u.id = f.user_id
    LEFT JOIN public.affiliate_links l ON l.id = f.link_id
    WHERE (p_flag_type IS NULL OR f.flag_type = p_flag_type)
      AND (p_severity IS NULL OR f.severity = p_severity)
      AND (p_status IS NULL OR f.status = p_status)
      AND (v_search = '' OR (
        COALESCE(u.full_name, '') ILIKE '%' || replace(replace(v_search, '%', ''), '_', '') || '%'
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
