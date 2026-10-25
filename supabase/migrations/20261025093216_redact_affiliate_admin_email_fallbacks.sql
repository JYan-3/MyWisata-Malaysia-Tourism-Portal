-- Do not return raw email addresses from affiliate admin aggregates.

CREATE OR REPLACE FUNCTION public.get_affiliate_fraud_analytics(p_range text DEFAULT '30d')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_days integer;
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_range IS NULL OR p_range NOT IN ('7d','30d','90d') THEN RAISE EXCEPTION 'fraud_range_invalid' USING ERRCODE = '22023'; END IF;
  v_days := CASE p_range WHEN '7d' THEN 7 WHEN '30d' THEN 30 ELSE 90 END;

  WITH bounds AS (
    SELECT v_now - make_interval(days => v_days) AS cutoff, v_now AS snapshot_cutoff
  ), flags AS MATERIALIZED (
    SELECT f.id, f.user_id, f.flag_type, f.severity, f.status, f.created_at
    FROM public.affiliate_fraud_flags f CROSS JOIN bounds
    WHERE f.created_at >= bounds.cutoff AND f.created_at <= bounds.snapshot_cutoff
  ), daily AS (
    SELECT day::date AS day, count(flags.id)::bigint AS count
    FROM bounds
    CROSS JOIN LATERAL generate_series(date_trunc('day', bounds.cutoff), date_trunc('day', bounds.snapshot_cutoff), interval '1 day') AS series(day)
    LEFT JOIN flags ON flags.created_at >= day AND flags.created_at < day + interval '1 day'
    GROUP BY day
  ), types AS (
    SELECT category.flag_type, count(flags.id)::bigint AS count
    FROM unnest(ARRAY['self_referral','duplicate_attribution','expired_attribution','click_velocity','visitor_clustering','zero_conversion','click_cap_reached','vendor_ineligible']) category(flag_type)
    LEFT JOIN flags ON flags.flag_type = category.flag_type
    GROUP BY category.flag_type
  ), severities AS (
    SELECT category.severity, count(flags.id)::bigint AS count
    FROM unnest(ARRAY['low','medium','high']) category(severity)
    LEFT JOIN flags ON flags.severity = category.severity
    GROUP BY category.severity
  ), headline AS (
    SELECT count(*)::bigint AS total_flags,
      count(*) FILTER (WHERE flag_type='self_referral')::bigint AS self_referrals_blocked,
      count(*) FILTER (WHERE flag_type='duplicate_attribution')::bigint AS duplicate_payouts_prevented,
      count(*) FILTER (WHERE status='open')::bigint AS open_flags,
      count(*) FILTER (WHERE status='reviewed')::bigint AS reviewed_flags,
      count(*) FILTER (WHERE status='dismissed')::bigint AS dismissed_flags
    FROM flags
  ), top_users AS (
    SELECT user_id, count(*)::bigint AS flag_count FROM flags
    WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY count(*) DESC, user_id LIMIT 5
  ), auto_disabled AS (
    SELECT count(*)::bigint AS count FROM public.audit_logs audit CROSS JOIN bounds
    WHERE audit.action='affiliate.link.disabled' AND audit.entity_type='affiliate_links'
      AND audit.actor_id IS NULL AND audit.created_at >= bounds.cutoff AND audit.created_at <= bounds.snapshot_cutoff
  )
  SELECT jsonb_build_object(
    'range',p_range,
    'overTime',coalesce((SELECT jsonb_agg(jsonb_build_object('date',day::text,'count',count) ORDER BY day) FROM daily),'[]'::jsonb),
    'byType',coalesce((SELECT jsonb_agg(jsonb_build_object('flagType',flag_type,'count',count) ORDER BY flag_type) FROM types),'[]'::jsonb),
    'bySeverity',coalesce((SELECT jsonb_agg(jsonb_build_object('severity',severity,'count',count) ORDER BY severity) FROM severities),'[]'::jsonb),
    'headline',(SELECT jsonb_build_object('totalFlags',total_flags,'selfReferralsBlocked',self_referrals_blocked,
      'duplicatePayoutsPrevented',duplicate_payouts_prevented,'openFlags',open_flags,'reviewedFlags',reviewed_flags,
      'dismissedFlags',dismissed_flags,'linksAutoDisabled',(SELECT count FROM auto_disabled)) FROM headline),
    'topFlaggedAffiliates',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'userId',top_users.user_id,'userName',coalesce(nullif(trim(users.full_name), ''), 'Unknown user'),
      'affiliateCode',code.affiliate_code,'flagCount',top_users.flag_count) ORDER BY top_users.flag_count DESC,top_users.user_id)
      FROM top_users LEFT JOIN public.users users ON users.id=top_users.user_id
      LEFT JOIN LATERAL (SELECT link.affiliate_code FROM public.affiliate_links link
        WHERE link.user_id=top_users.user_id ORDER BY link.created_at DESC,link.id LIMIT 1) code ON true),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_affiliate_fraud_analytics(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_fraud_analytics(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_affiliate_admin_summary()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH links AS MATERIALIZED (
    SELECT link.id, link.user_id, link.affiliate_code,
      coalesce(nullif(trim(users.full_name), ''), 'Unknown user') AS user_name
    FROM public.affiliate_links link
    LEFT JOIN public.users users ON users.id = link.user_id
  ), clicks_by_link AS (
    SELECT click.link_id, count(*)::bigint AS click_count
    FROM public.affiliate_clicks click GROUP BY click.link_id
  ), referral_by_link AS (
    SELECT click.link_id, count(*)::bigint AS referral_count,
      coalesce(sum(attribution.commission_amount),0) AS commission
    FROM public.affiliate_attributions attribution
    JOIN public.affiliate_clicks click ON click.id=attribution.click_id
    WHERE attribution.status NOT IN ('reversed','rejected')
    GROUP BY click.link_id
  ), confirmed_by_link AS (
    SELECT click.link_id, count(*)::bigint AS confirmed_count,
      coalesce(sum(round(order_row.total_amount*100)::bigint),0)::bigint AS sales_amount_sen,
      max(attribution.created_at) AS last_confirmed_at
    FROM public.affiliate_attributions attribution
    JOIN public.affiliate_clicks click ON click.id=attribution.click_id
    LEFT JOIN public.orders order_row ON order_row.id=attribution.order_id
    WHERE attribution.status='confirmed'
    GROUP BY click.link_id
  ), fraud_by_link AS (
    SELECT flag.link_id, count(*)::bigint AS flag_count
    FROM public.affiliate_fraud_flags flag
    WHERE flag.status <> 'dismissed'
      AND flag.flag_type NOT IN ('self_referral','expired_attribution')
    GROUP BY flag.link_id
  ), link_signals AS (
    SELECT links.*, coalesce(clicks.click_count,0)::bigint AS click_count,
      coalesce(referrals.referral_count,0)::bigint AS referral_count,
      coalesce(referrals.commission,0) AS commission,
      coalesce(confirmed.confirmed_count,0)::bigint AS confirmed_count,
      coalesce(confirmed.sales_amount_sen,0)::bigint AS sales_amount_sen,
      confirmed.last_confirmed_at,
      coalesce(fraud.flag_count,0)::bigint AS flag_count
    FROM links
    LEFT JOIN clicks_by_link clicks ON clicks.link_id=links.id
    LEFT JOIN referral_by_link referrals ON referrals.link_id=links.id
    LEFT JOIN confirmed_by_link confirmed ON confirmed.link_id=links.id
    LEFT JOIN fraud_by_link fraud ON fraud.link_id=links.id
  ), top_earners AS (
    SELECT signals.*,
      coalesce((
        SELECT rule.tier_name FROM public.commission_rules rule
        WHERE rule.rule_type='affiliate' AND rule.is_active AND rule.tier_name IS NOT NULL
          AND signals.confirmed_count >= coalesce(rule.min_conversions,0)
          AND signals.sales_amount_sen >= coalesce(rule.min_sales_amount_sen,0)
          AND (rule.active_period_days IS NULL OR (signals.last_confirmed_at IS NOT NULL
            AND floor(extract(epoch FROM now()-signals.last_confirmed_at)/86400) <= rule.active_period_days))
          AND (rule.max_fraud_rate_percent IS NULL OR signals.click_count = 0
            OR signals.flag_count::numeric / signals.click_count * 100 <= rule.max_fraud_rate_percent)
        ORDER BY rule.min_conversions DESC, rule.id DESC LIMIT 1
      ), (
        SELECT rule.tier_name FROM public.commission_rules rule
        WHERE rule.rule_type='affiliate' AND rule.is_active AND rule.tier_name IS NOT NULL
        ORDER BY rule.min_conversions, rule.id LIMIT 1
      ), 'standard') AS tier_name
    FROM link_signals signals
    WHERE signals.commission > 0
    ORDER BY signals.commission DESC, signals.id
    LIMIT 10
  ), all_totals AS (
    SELECT (SELECT count(*) FROM links)::bigint AS total_affiliates,
      (SELECT count(*) FROM public.affiliate_clicks)::bigint AS total_clicks,
      (SELECT count(*) FROM public.affiliate_attributions WHERE status NOT IN ('reversed','rejected'))::bigint AS total_referrals,
      coalesce((SELECT sum(commission_amount) FROM public.affiliate_attributions WHERE status NOT IN ('reversed','rejected')),0) AS total_commission,
      (SELECT count(*) FROM public.share_events)::bigint AS shares,
      (SELECT count(*) FROM public.affiliate_attributions WHERE status NOT IN ('reversed','rejected'))::bigint AS conversions,
      EXISTS(SELECT 1 FROM public.affiliate_clicks WHERE source IS NOT NULL) AS source_tracking_active
  ), platform_shares AS (
    SELECT coalesce(platform,'unknown') AS platform, count(*)::bigint AS share_count
    FROM public.share_events GROUP BY coalesce(platform,'unknown')
  ), platform_clicks AS (
    SELECT click.source AS platform, count(*)::bigint AS click_count,
      count(DISTINCT click.id) FILTER (WHERE attribution.id IS NOT NULL)::bigint AS conversion_count
    FROM public.affiliate_clicks click
    LEFT JOIN public.affiliate_attributions attribution
      ON attribution.click_id=click.id AND attribution.status NOT IN ('reversed','rejected')
    WHERE click.source IS NOT NULL GROUP BY click.source
  ), platforms AS (
    SELECT platform FROM platform_shares UNION SELECT platform FROM platform_clicks
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object('totalAffiliates',all_totals.total_affiliates,
      'totalClicks',all_totals.total_clicks,'totalReferrals',all_totals.total_referrals,
      'totalCommission',all_totals.total_commission),
    'topEarners', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'userId',top_earners.user_id,'userName',top_earners.user_name,
      'affiliateCode',top_earners.affiliate_code,'referrals',top_earners.referral_count,
      'commission',top_earners.commission,'tierName',top_earners.tier_name)
      ORDER BY top_earners.commission DESC,top_earners.id) FROM top_earners),'[]'::jsonb),
    'funnel', jsonb_build_object('shares',all_totals.shares,'clicks',all_totals.total_clicks,
      'conversions',all_totals.conversions,
      'shareToClickRate',CASE WHEN all_totals.shares>0 THEN all_totals.total_clicks::numeric/all_totals.shares ELSE NULL END,
      'clickToConversionRate',CASE WHEN all_totals.total_clicks>0 THEN all_totals.conversions::numeric/all_totals.total_clicks ELSE NULL END,
      'sourceTrackingActive',all_totals.source_tracking_active,
      'byPlatform',coalesce((SELECT jsonb_agg(jsonb_build_object('platform',platforms.platform,
        'shares',coalesce(platform_shares.share_count,0),
        'clicks',CASE WHEN all_totals.source_tracking_active THEN coalesce(platform_clicks.click_count,0) ELSE NULL END,
        'conversions',CASE WHEN all_totals.source_tracking_active THEN coalesce(platform_clicks.conversion_count,0) ELSE NULL END)
        ORDER BY coalesce(platform_shares.share_count,0) DESC,platforms.platform)
        FROM platforms LEFT JOIN platform_shares USING(platform) LEFT JOIN platform_clicks USING(platform)),'[]'::jsonb))
  )
  FROM all_totals;
$$;
REVOKE ALL ON FUNCTION public.get_affiliate_admin_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_admin_summary() TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_affiliate_attribution_page(
  p_snapshot_cutoff timestamptz DEFAULT now(),
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_sort_key text DEFAULT 'createdAt',
  p_sort_dir text DEFAULT 'desc',
  p_page_size integer DEFAULT 10,
  p_cursor jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot_cutoff IS NULL OR p_page_size NOT IN (10,25,50)
    OR p_sort_key NOT IN ('createdAt','userName','productName','status')
    OR p_sort_dir NOT IN ('asc','desc')
    OR p_status IS NOT NULL AND p_status NOT IN ('pending','confirmed','reversed','rejected')
    OR length(coalesce(p_search,'')) > 100 THEN
    RAISE EXCEPTION 'affiliate_attribution_page_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_cursor IS NOT NULL AND (p_cursor->>'sortValue' IS NULL OR p_cursor->>'createdAt' IS NULL OR p_cursor->>'id' IS NULL) THEN
    RAISE EXCEPTION 'affiliate_attribution_cursor_invalid' USING ERRCODE = '22023';
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT attribution.id, link.user_id,
      coalesce(nullif(trim(users.full_name), ''), 'Unknown user') AS user_name,
      CASE WHEN click.target_type='product' THEN click.target_id::text ELSE NULL END AS product_id,
      CASE WHEN click.target_type='product' THEN coalesce(product.name,'Deleted listing') ELSE NULL END AS product_name,
      attribution.order_id, attribution.commission_amount, attribution.status, attribution.created_at,
      review.status AS review_status, review.version AS review_version, review.evidence_code AS review_evidence,
      CASE p_sort_key
        WHEN 'createdAt' THEN to_char(attribution.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        WHEN 'userName' THEN lower(coalesce(nullif(trim(users.full_name), ''), 'Unknown user'))
        WHEN 'productName' THEN lower(coalesce(product.name,'Deleted listing'))
        ELSE attribution.status
      END AS sort_value
    FROM public.affiliate_attributions attribution
    JOIN public.affiliate_clicks click ON click.id=attribution.click_id
    JOIN public.affiliate_links link ON link.id=click.link_id
    LEFT JOIN public.users users ON users.id=link.user_id
    LEFT JOIN LATERAL (
      SELECT product_row.name FROM public.products product_row
      WHERE click.target_type='product'
        AND (product_row.id=click.target_id OR product_row.slug=click.target_id::text)
      ORDER BY (product_row.id=click.target_id) DESC
      LIMIT 1
    ) product ON true
    LEFT JOIN public.affiliate_guest_commission_reviews review ON review.attribution_id=attribution.id
    WHERE attribution.created_at <= p_snapshot_cutoff
      AND (p_status IS NULL OR attribution.status=p_status)
      AND (nullif(trim(p_search),'') IS NULL OR coalesce(nullif(trim(users.full_name), ''), 'Unknown user') ILIKE '%'||trim(p_search)||'%'
        OR coalesce(product.name,'') ILIKE '%'||trim(p_search)||'%'
        OR attribution.order_id::text ILIKE '%'||trim(p_search)||'%')
  ), totals AS (
    SELECT count(*)::bigint AS total_count FROM filtered
  ), page_candidates AS (
    SELECT * FROM filtered
    WHERE p_cursor IS NULL OR
      (p_sort_dir='asc' AND (sort_value > p_cursor->>'sortValue'
        OR (sort_value=p_cursor->>'sortValue' AND (created_at,id) < ((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid)))) OR
      (p_sort_dir='desc' AND (sort_value < p_cursor->>'sortValue'
        OR (sort_value=p_cursor->>'sortValue' AND (created_at,id) < ((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))))
    ORDER BY CASE WHEN p_sort_dir='asc' THEN sort_value END ASC,
      CASE WHEN p_sort_dir='desc' THEN sort_value END DESC, created_at DESC,id DESC
    LIMIT p_page_size+1
  ), page_items AS (
    SELECT * FROM page_candidates ORDER BY
      CASE WHEN p_sort_dir='asc' THEN sort_value END ASC,
      CASE WHEN p_sort_dir='desc' THEN sort_value END DESC, created_at DESC,id DESC
    LIMIT p_page_size
  ), page_info AS (SELECT count(*)>p_page_size AS has_more FROM page_candidates),
  next_cursor AS (SELECT sort_value,created_at,id FROM page_items ORDER BY
      CASE WHEN p_sort_dir='asc' THEN sort_value END DESC,
      CASE WHEN p_sort_dir='desc' THEN sort_value END ASC, created_at ASC,id ASC LIMIT 1)
  SELECT jsonb_build_object('snapshotCutoff',p_snapshot_cutoff,'totalCount',totals.total_count,
    'pageSize',p_page_size,'hasMore',page_info.has_more,
    'nextCursor',CASE WHEN page_info.has_more THEN (SELECT jsonb_build_object('sortValue',sort_value,'createdAt',created_at,'id',id) FROM next_cursor) ELSE NULL END,
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',page_items.id,'userId',page_items.user_id,
      'userName',page_items.user_name,'productId',page_items.product_id,'productName',page_items.product_name,
      'orderId',page_items.order_id,'commissionAmount',page_items.commission_amount,'status',page_items.status,
      'createdAt',page_items.created_at,'reviewStatus',page_items.review_status,
      'reviewVersion',page_items.review_version,'reviewEvidence',page_items.review_evidence)
      ORDER BY CASE WHEN p_sort_dir='asc' THEN page_items.sort_value END ASC,
        CASE WHEN p_sort_dir='desc' THEN page_items.sort_value END DESC,page_items.created_at DESC,page_items.id DESC)
      FROM page_items),'[]'::jsonb))
  INTO v_result FROM totals CROSS JOIN page_info;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_affiliate_attribution_page(timestamptz,text,text,text,text,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_affiliate_attribution_page(timestamptz,text,text,text,text,integer,jsonb) TO service_role;
