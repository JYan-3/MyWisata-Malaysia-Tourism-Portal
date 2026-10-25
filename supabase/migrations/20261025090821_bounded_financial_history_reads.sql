CREATE OR REPLACE FUNCTION public.get_recommendation_earnings_page(
  p_recommendation_id uuid DEFAULT NULL,
  p_snapshot_cutoff timestamptz DEFAULT now(),
  p_page_size integer DEFAULT 10,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' OR p_snapshot_cutoff IS NULL THEN
    RAISE EXCEPTION 'authenticated_user_required' USING ERRCODE = '42501';
  END IF;
  IF p_page_size IS NULL OR p_page_size NOT IN (10, 25, 50) THEN
    RAISE EXCEPTION 'page_size_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_invalid' USING ERRCODE = '22023';
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT commission.id, commission.conversion_id, commission.commission_type,
      commission.amount, commission.commission_rate, commission.status,
      commission.hold_until, commission.created_at,
      conversion.recommendation_id, recommendation.vendor_name
    FROM public.recommendation_commissions AS commission
    LEFT JOIN public.recommendation_conversions AS conversion
      ON conversion.id = commission.conversion_id
    LEFT JOIN public.vendor_recommendations AS recommendation
      ON recommendation.id = conversion.recommendation_id
    WHERE commission.recommender_id = v_user_id
      AND commission.created_at <= p_snapshot_cutoff
      AND (p_recommendation_id IS NULL OR conversion.recommendation_id = p_recommendation_id)
  ), totals AS (
    SELECT
      coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0) AS pending,
      coalesce(sum(amount) FILTER (WHERE status = 'confirmed'), 0) AS lifetime_cleared,
      count(DISTINCT conversion_id) FILTER (WHERE status IN ('pending', 'confirmed')) AS converted_vendors,
      count(*) AS total_count
    FROM filtered
  ), page_candidates AS (
    SELECT * FROM filtered
    WHERE p_before_created_at IS NULL
      OR created_at < p_before_created_at
      OR (created_at = p_before_created_at AND id < p_before_id)
    ORDER BY created_at DESC, id DESC
    LIMIT p_page_size + 1
  ), page_items AS (
    SELECT * FROM page_candidates
    ORDER BY created_at DESC, id DESC
    LIMIT p_page_size
  ), page_info AS (
    SELECT count(*) > p_page_size AS has_more FROM page_candidates
  ), next_cursor AS (
    SELECT created_at, id FROM page_items ORDER BY created_at ASC, id ASC LIMIT 1
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'pending', totals.pending,
      'lifetimeCleared', totals.lifetime_cleared,
      'convertedVendors', totals.converted_vendors
    ),
    'snapshotCutoff', p_snapshot_cutoff,
    'totalCount', totals.total_count,
    'pageSize', p_page_size,
    'hasMore', page_info.has_more,
    'nextCursor', CASE WHEN page_info.has_more THEN jsonb_build_object(
      'createdAt', next_cursor.created_at,
      'id', next_cursor.id
    ) ELSE NULL END,
    'commissions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', page_items.id,
        'conversionId', page_items.conversion_id,
        'commissionType', page_items.commission_type,
        'amount', page_items.amount,
        'commissionRate', page_items.commission_rate,
        'status', page_items.status,
        'holdUntil', page_items.hold_until,
        'createdAt', page_items.created_at,
        'recommendationId', page_items.recommendation_id,
        'vendorName', page_items.vendor_name
      ) ORDER BY page_items.created_at DESC, page_items.id DESC)
      FROM page_items
    ), '[]'::jsonb)
  ) INTO v_result
  FROM totals CROSS JOIN page_info LEFT JOIN next_cursor ON true;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_recommendation_earnings_page(uuid, timestamptz, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recommendation_earnings_page(uuid, timestamptz, integer, timestamptz, uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS recommendation_commissions_owner_history_idx
  ON public.recommendation_commissions (recommender_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.get_affiliate_earnings_page(
  p_user_id uuid,
  p_since timestamptz,
  p_snapshot_cutoff timestamptz,
  p_page_size integer DEFAULT 10,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_snapshot_cutoff IS NULL OR p_page_size IS NULL OR p_page_size NOT IN (10, 25, 50)
    OR (p_since IS NOT NULL AND p_since > p_snapshot_cutoff) THEN
    RAISE EXCEPTION 'affiliate_earnings_page_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_invalid' USING ERRCODE = '22023';
  END IF;

  WITH owner_links AS MATERIALIZED (
    SELECT id FROM public.affiliate_links WHERE user_id = p_user_id
  ), filtered AS MATERIALIZED (
    SELECT attribution.id, attribution.click_id, attribution.order_id,
      attribution.commission_rate, attribution.commission_amount, attribution.status,
      attribution.created_at, attribution.cleared_at, attribution.confirmed_at,
      click.target_type, click.target_id, order_row.display_id, order_row.total_amount
    FROM public.affiliate_attributions AS attribution
    JOIN public.affiliate_clicks AS click ON click.id = attribution.click_id
    JOIN owner_links AS owner_link ON owner_link.id = click.link_id
    LEFT JOIN public.orders AS order_row ON order_row.id = attribution.order_id
    WHERE attribution.created_at <= p_snapshot_cutoff
      AND (p_since IS NULL OR attribution.created_at >= p_since)
  ), totals AS (
    SELECT count(*)::bigint AS total_count,
      coalesce(sum(commission_amount) FILTER (WHERE status = 'pending'), 0) AS pending_amount,
      coalesce(sum(commission_amount) FILTER (WHERE status NOT IN ('reversed', 'rejected')), 0) AS total_amount
    FROM filtered
  ), page_candidates AS (
    SELECT * FROM filtered
    WHERE p_before_created_at IS NULL
      OR created_at < p_before_created_at
      OR (created_at = p_before_created_at AND id < p_before_id)
    ORDER BY created_at DESC, id DESC
    LIMIT p_page_size + 1
  ), page_items AS (
    SELECT * FROM page_candidates ORDER BY created_at DESC, id DESC LIMIT p_page_size
  ), page_info AS (
    SELECT count(*) > p_page_size AS has_more FROM page_candidates
  ), next_cursor AS (
    SELECT created_at, id FROM page_items ORDER BY created_at ASC, id ASC LIMIT 1
  )
  SELECT jsonb_build_object(
    'snapshotCutoff', p_snapshot_cutoff,
    'totalCount', totals.total_count,
    'pendingAmount', totals.pending_amount,
    'totalAmount', totals.total_amount,
    'pageSize', p_page_size,
    'hasMore', page_info.has_more,
    'nextCursor', CASE WHEN page_info.has_more THEN jsonb_build_object(
      'createdAt', next_cursor.created_at, 'id', next_cursor.id
    ) ELSE NULL END,
    'commissions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', page_items.id, 'targetType', page_items.target_type,
        'targetId', page_items.target_id, 'displayId', page_items.display_id,
        'orderAmount', page_items.total_amount, 'rate', page_items.commission_rate,
        'amount', page_items.commission_amount, 'status', page_items.status,
        'createdAt', page_items.created_at, 'clearedAt', coalesce(page_items.cleared_at, page_items.confirmed_at)
      ) ORDER BY page_items.created_at DESC, page_items.id DESC)
      FROM page_items
    ), '[]'::jsonb)
  ) INTO v_result
  FROM totals CROSS JOIN page_info LEFT JOIN next_cursor ON true;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_affiliate_earnings_page(uuid, timestamptz, timestamptz, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_earnings_page(uuid, timestamptz, timestamptz, integer, timestamptz, uuid) TO service_role;

CREATE INDEX IF NOT EXISTS affiliate_attributions_history_idx
  ON public.affiliate_attributions (click_id, created_at DESC, id DESC);

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
      'userId',top_users.user_id,'userName',coalesce(users.full_name,users.email,'Unknown user'),
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

CREATE OR REPLACE FUNCTION public.get_my_affiliate_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'authenticated_user_required' USING ERRCODE = '42501';
  END IF;

  WITH owner_links AS MATERIALIZED (
    SELECT id, user_id, affiliate_code, created_at
    FROM public.affiliate_links WHERE user_id = v_user_id
  ), clicks AS MATERIALIZED (
    SELECT click.id, click.link_id, click.target_type, click.target_id, click.source, click.campaign, click.created_at
    FROM public.affiliate_clicks click JOIN owner_links link ON link.id = click.link_id
  ), shares AS MATERIALIZED (
    SELECT event.content_type, event.content_id, event.platform
    FROM public.share_events event JOIN owner_links link ON link.id = event.affiliate_id
  ), attributions AS MATERIALIZED (
    SELECT attribution.id, attribution.click_id, attribution.order_id, attribution.commission_rate,
      attribution.commission_amount, attribution.status, attribution.created_at, attribution.cleared_at
    FROM public.affiliate_attributions attribution JOIN clicks click ON click.id = attribution.click_id
  ), totals AS (
    SELECT (SELECT count(*) FROM clicks) AS click_count,
      count(*) FILTER (WHERE status NOT IN ('reversed','rejected')) AS referral_count,
      coalesce(sum(commission_amount) FILTER (WHERE status='pending'),0) AS pending_amount,
      coalesce(sum(commission_amount) FILTER (WHERE status NOT IN ('reversed','rejected')),0) AS total_amount
    FROM attributions
  ), product_ids AS (
    SELECT target_id AS product_id FROM clicks WHERE target_type='product' AND target_id IS NOT NULL
    UNION
    SELECT content_id FROM shares WHERE content_type='product' AND content_id IS NOT NULL
  ), product_groups AS (
    SELECT product.product_id,
      count(DISTINCT click.id)::bigint AS click_count,
      (SELECT count(*) FROM shares share WHERE share.content_type='product' AND share.content_id=product.product_id) AS share_count,
      count(attribution.id) FILTER (WHERE attribution.status NOT IN ('reversed','rejected'))::bigint AS referral_count,
      coalesce(sum(attribution.commission_amount) FILTER (WHERE attribution.status NOT IN ('reversed','rejected')),0) AS earnings,
      count(attribution.id) FILTER (WHERE attribution.status='reversed')::bigint AS reversed_count
    FROM product_ids product
    LEFT JOIN clicks click ON click.target_type='product' AND click.target_id=product.product_id
    LEFT JOIN attributions attribution ON attribution.click_id=click.id
    GROUP BY product.product_id
  ), campaign_groups AS (
    SELECT click.campaign,
      count(DISTINCT click.id)::bigint AS click_count,
      count(attribution.id) FILTER (WHERE attribution.status NOT IN ('reversed','rejected'))::bigint AS referral_count,
      coalesce(sum(attribution.commission_amount) FILTER (WHERE attribution.status NOT IN ('reversed','rejected')),0) AS earnings
    FROM clicks click LEFT JOIN attributions attribution ON attribution.click_id=click.id
    GROUP BY click.campaign
  ), daily AS (
    SELECT (click.created_at AT TIME ZONE 'UTC')::date AS day, count(*)::bigint AS click_count
    FROM clicks click WHERE click.created_at >= now() - interval '30 days'
    GROUP BY (click.created_at AT TIME ZONE 'UTC')::date
  ), funnel_sources AS (
    SELECT platform.platform,
      coalesce(shares.share_count,0)::bigint AS share_count,
      coalesce(source_clicks.click_count,0)::bigint AS click_count,
      coalesce(source_clicks.conversion_count,0)::bigint AS conversion_count
    FROM (
      SELECT platform FROM (SELECT coalesce(platform,'unknown') AS platform FROM shares
        UNION SELECT source AS platform FROM clicks WHERE source IS NOT NULL) all_platforms
    ) platform
    LEFT JOIN (SELECT coalesce(platform,'unknown') AS platform,count(*) AS share_count FROM shares GROUP BY coalesce(platform,'unknown')) shares
      ON shares.platform=platform.platform
    LEFT JOIN (SELECT click.source AS platform,count(*) AS click_count,
      count(DISTINCT click.id) FILTER (WHERE attribution.id IS NOT NULL AND attribution.status NOT IN ('reversed','rejected')) AS conversion_count
      FROM clicks click LEFT JOIN attributions attribution ON attribution.click_id=click.id
      WHERE click.source IS NOT NULL GROUP BY click.source) source_clicks
      ON source_clicks.platform=platform.platform
  ), recent_rows AS (
    SELECT attribution.id, click.target_type, click.target_id, order_row.total_amount,
      attribution.commission_rate, attribution.commission_amount, attribution.status,
      attribution.created_at, attribution.cleared_at
    FROM attributions attribution JOIN clicks click ON click.id=attribution.click_id
    LEFT JOIN public.orders order_row ON order_row.id=attribution.order_id
    ORDER BY attribution.created_at DESC, attribution.id DESC LIMIT 5
  )
  SELECT jsonb_build_object(
    'affiliateCode',(SELECT affiliate_code FROM owner_links ORDER BY created_at DESC,id DESC LIMIT 1),
    'totals',jsonb_build_object(
      'clicks',totals.click_count,'referrals',totals.referral_count,
      'pendingEarnings',totals.pending_amount,
      'availableToWithdraw',coalesce((SELECT wallet.earnings_sen FROM public.wallets wallet WHERE wallet.user_id=v_user_id),0)::numeric/100,
      'totalEarnings',totals.total_amount
    ),
    'byProduct',coalesce((SELECT jsonb_agg(jsonb_build_object('productId',product_id,'shares',share_count,
      'clicks',click_count,'referrals',referral_count,'earnings',earnings,'reversedReferrals',reversed_count)
      ORDER BY earnings DESC,product_id) FROM product_groups),'[]'::jsonb),
    'byCampaign',coalesce((SELECT jsonb_agg(jsonb_build_object('campaign',campaign,'clicks',click_count,
      'referrals',referral_count,'earnings',earnings) ORDER BY earnings DESC,campaign) FROM campaign_groups),'[]'::jsonb),
    'clicksByDay',coalesce((SELECT jsonb_agg(jsonb_build_object('date',day::text,'clicks',click_count) ORDER BY day) FROM (
      SELECT series.day::date AS day, coalesce(daily.click_count,0)::bigint AS click_count
      FROM generate_series((now()-interval '29 days')::date,now()::date,interval '1 day') series(day)
      LEFT JOIN daily ON daily.day=series.day::date
    ) days),'[]'::jsonb),
    'funnel',jsonb_build_object(
      'shares',(SELECT count(*) FROM shares),'clicks',(SELECT count(*) FROM clicks),
      'conversions',(SELECT count(*) FROM attributions WHERE status NOT IN ('reversed','rejected')),
      'shareToClickRate',CASE WHEN (SELECT count(*) FROM shares)>0 THEN (SELECT count(*)::numeric FROM clicks)/(SELECT count(*) FROM shares) ELSE NULL END,
      'clickToConversionRate',CASE WHEN (SELECT count(*) FROM clicks)>0 THEN (SELECT count(*) FILTER (WHERE status NOT IN ('reversed','rejected'))::numeric FROM attributions)/(SELECT count(*) FROM clicks) ELSE NULL END,
      'sourceTrackingActive',EXISTS(SELECT 1 FROM clicks WHERE source IS NOT NULL),
      'byPlatform',coalesce((SELECT jsonb_agg(jsonb_build_object('platform',platform,'shares',share_count,
        'clicks',CASE WHEN EXISTS(SELECT 1 FROM clicks WHERE source IS NOT NULL) THEN click_count ELSE NULL END,
        'conversions',CASE WHEN EXISTS(SELECT 1 FROM clicks WHERE source IS NOT NULL) THEN conversion_count ELSE NULL END)
        ORDER BY share_count DESC,platform) FROM funnel_sources),'[]'::jsonb)
    ),
    'commissions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'productId',target_id,'targetType',target_type,
      'orderAmount',total_amount,'rate',commission_rate,'amount',commission_amount,'status',status,
      'createdAt',created_at,'clearedAt',cleared_at) ORDER BY created_at DESC,id DESC) FROM recent_rows),'[]'::jsonb)
  ) INTO v_result FROM totals;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_affiliate_dashboard_summary() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_affiliate_dashboard_summary() TO authenticated;

CREATE INDEX IF NOT EXISTS affiliate_clicks_owner_dashboard_idx
  ON public.affiliate_clicks (link_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS share_events_affiliate_dashboard_idx
  ON public.share_events (affiliate_id, content_type, content_id);

CREATE OR REPLACE FUNCTION public.get_affiliate_admin_summary()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH links AS MATERIALIZED (
    SELECT link.id, link.user_id, link.affiliate_code,
      coalesce(users.full_name, users.email, 'Unknown user') AS user_name
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
      coalesce(users.full_name,users.email,'Unknown user') AS user_name,
      CASE WHEN click.target_type='product' THEN click.target_id::text ELSE NULL END AS product_id,
      CASE WHEN click.target_type='product' THEN coalesce(product.name,'Deleted listing') ELSE NULL END AS product_name,
      attribution.order_id, attribution.commission_amount, attribution.status, attribution.created_at,
      review.status AS review_status, review.version AS review_version, review.evidence_code AS review_evidence,
      CASE p_sort_key
        WHEN 'createdAt' THEN to_char(attribution.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        WHEN 'userName' THEN lower(coalesce(users.full_name,users.email,'Unknown user'))
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
      AND (nullif(trim(p_search),'') IS NULL OR coalesce(users.full_name,users.email,'Unknown user') ILIKE '%'||trim(p_search)||'%'
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
