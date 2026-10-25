-- Consolidate lifetime financial scans after the 100k synthetic RPC budget check.
-- Preserve source semantics and NULL cash/net-margin until trusted sources exist.
CREATE OR REPLACE FUNCTION app_private.compute_financial_operations_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '4s'
AS $$
DECLARE
  v_now timestamptz := now();
  v_cached app_private.financial_health_snapshot%ROWTYPE;
  v_result jsonb;
  v_queues jsonb;
  v_withdrawal_queues jsonb;
  v_liabilities jsonb;
  v_economics jsonb;
  v_review jsonb;
  v_totals jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cached FROM app_private.financial_health_snapshot WHERE singleton;
  IF FOUND AND v_cached.computed_at > v_now - interval '60 seconds' THEN
    RETURN v_cached.snapshot;
  END IF;

  IF NOT pg_try_advisory_xact_lock(70251001) THEN
    IF FOUND THEN RETURN jsonb_set(v_cached.snapshot, '{availability}', '"stale"'::jsonb); END IF;
    RETURN jsonb_build_object('computedAt', NULL, 'windowStart', v_now - interval '1 hour',
      'windowEnd', v_now, 'availability', 'unavailable', 'unavailableReasons', jsonb_build_array('refresh_in_progress'),
      'queues', jsonb_build_object(
        'paidEffects',jsonb_build_object('availability','unavailable','pending',NULL,'oldestPendingSeconds',NULL,'enteredLastHour',NULL,'reenteredLastHour',NULL,'retriesLastHour',NULL,'completedLastHour',NULL,'reviewRequired',NULL,'sampleCount',0,'unavailableReason','refresh_in_progress'),
        'affiliateClearing',jsonb_build_object('availability','unavailable','pending',NULL,'oldestPendingSeconds',NULL,'enteredLastHour',NULL,'reenteredLastHour',NULL,'retriesLastHour',NULL,'completedLastHour',NULL,'reviewRequired',NULL,'sampleCount',0,'unavailableReason','refresh_in_progress'),
        'guestReview',jsonb_build_object('availability','unavailable','pending',NULL,'oldestPendingSeconds',NULL,'enteredLastHour',NULL,'reenteredLastHour',NULL,'retriesLastHour',NULL,'completedLastHour',NULL,'reviewRequired',NULL,'sampleCount',0,'unavailableReason','refresh_in_progress'),
        'withdrawalReview',jsonb_build_object('availability','unavailable','pending',NULL,'oldestPendingSeconds',NULL,'enteredLastHour',NULL,'reenteredLastHour',NULL,'retriesLastHour',NULL,'completedLastHour',NULL,'reviewRequired',NULL,'sampleCount',0,'unavailableReason','refresh_in_progress'),
        'payoutUnknown',jsonb_build_object('availability','unavailable','pending',NULL,'oldestPendingSeconds',NULL,'enteredLastHour',NULL,'reenteredLastHour',NULL,'retriesLastHour',NULL,'completedLastHour',NULL,'reviewRequired',NULL,'sampleCount',0,'unavailableReason','refresh_in_progress'),
        'refundPending',jsonb_build_object('availability','unavailable','pending',NULL,'oldestPendingSeconds',NULL,'enteredLastHour',NULL,'reenteredLastHour',NULL,'retriesLastHour',NULL,'completedLastHour',NULL,'reviewRequired',NULL,'sampleCount',0,'unavailableReason','refresh_in_progress')
      ), 'liabilitiesSen', NULL, 'economicsSen', NULL, 'fraudReviewSample', NULL,
      'cashAvailableSen', NULL);
  END IF;

  SELECT jsonb_build_object(
    'paidEffects', jsonb_build_object(
      'availability','available',
      'pending',count(*) FILTER (WHERE status IN ('pending','retry','processing')),
      'oldestPendingSeconds',coalesce(extract(epoch FROM v_now - min(created_at) FILTER (WHERE status IN ('pending','retry','processing'))),0),
      'enteredLastHour',count(*) FILTER (WHERE created_at >= v_now - interval '1 hour'),
      'reenteredLastHour',NULL,'retriesLastHour',NULL,
      'completedLastHour',count(*) FILTER (WHERE status='completed' AND updated_at >= v_now - interval '1 hour'),
      'reviewRequired',count(*) FILTER (WHERE status='review_required'),
      'sampleCount',count(*),'unavailableReason',NULL
    )
  ) INTO v_queues FROM app_private.paid_order_effects_retry_progress
    WHERE status IN ('pending','retry','processing','review_required')
      OR (status='completed' AND updated_at >= v_now - interval '1 hour');

  v_queues := v_queues || jsonb_build_object(
    'affiliateClearing', (SELECT jsonb_build_object('availability','available',
      'pending',count(*) FILTER (WHERE attribution.status='pending' AND attribution.created_at <= v_now - interval '7 days'),
      'oldestPendingSeconds',coalesce(extract(epoch FROM v_now - min(attribution.created_at) FILTER (WHERE attribution.status='pending' AND attribution.created_at <= v_now - interval '7 days')),0),
      'enteredLastHour',count(*) FILTER (WHERE attribution.created_at >= v_now - interval '1 hour'),
      'reenteredLastHour',NULL,'retriesLastHour',NULL,
      'completedLastHour',count(*) FILTER (WHERE attribution.status='confirmed' AND attribution.cleared_at >= v_now - interval '1 hour'),
      'reviewRequired',0,'sampleCount',count(*),'unavailableReason',NULL)
      FROM public.affiliate_attributions attribution
      WHERE (attribution.status='pending' AND (attribution.created_at <= v_now - interval '7 days' OR attribution.created_at >= v_now - interval '1 hour'))
        OR (attribution.status='confirmed' AND attribution.cleared_at >= v_now - interval '1 hour')),
    'guestReview', (SELECT jsonb_build_object('availability','available',
      'pending',count(*) FILTER (WHERE status='pending'),
      'oldestPendingSeconds',coalesce(extract(epoch FROM v_now - min(created_at) FILTER (WHERE status='pending')),0),
      'enteredLastHour',count(*) FILTER (WHERE created_at >= v_now - interval '1 hour'),
      'reenteredLastHour',NULL,'retriesLastHour',NULL,
      'completedLastHour',count(*) FILTER (WHERE decided_at >= v_now - interval '1 hour'),
      'reviewRequired',count(*) FILTER (WHERE status='pending'),'sampleCount',count(*),'unavailableReason',NULL)
      FROM public.affiliate_guest_commission_reviews
      WHERE status='pending' OR decided_at >= v_now - interval '1 hour'),
    'refundPending', (SELECT jsonb_build_object('availability','available',
      'pending',count(*) FILTER (WHERE status IN ('pending','approved')),
      'oldestPendingSeconds',coalesce(extract(epoch FROM v_now - min(created_at) FILTER (WHERE status IN ('pending','approved'))),0),
      'enteredLastHour',count(*) FILTER (WHERE created_at >= v_now - interval '1 hour'),
      'reenteredLastHour',NULL,'retriesLastHour',NULL,
      'completedLastHour',count(*) FILTER (WHERE status='processed' AND processed_at >= v_now - interval '1 hour'),
      'reviewRequired',0,'sampleCount',count(*),'unavailableReason',NULL)
      FROM public.refunds WHERE status IN ('pending','approved') OR processed_at >= v_now - interval '1 hour')
  );

  SELECT jsonb_build_object(
    'withdrawalReview',jsonb_build_object('availability','available',
      'pending',count(*) FILTER (WHERE status IN ('pending','pending_second_approval','hold','overdue')),
      'oldestPendingSeconds',coalesce(extract(epoch FROM v_now - min(created_at) FILTER (WHERE status IN ('pending','pending_second_approval','hold','overdue'))),0),
      'enteredLastHour',count(*) FILTER (WHERE created_at >= v_now - interval '1 hour'),
      'reenteredLastHour',NULL,'retriesLastHour',NULL,
      'completedLastHour',count(*) FILTER (WHERE status IN ('paid','completed') AND updated_at >= v_now - interval '1 hour'),
      'reviewRequired',count(*) FILTER (WHERE status IN ('hold','overdue')),'sampleCount',count(*),'unavailableReason',NULL),
    'payoutUnknown',jsonb_build_object('availability','available',
      'pending',count(*) FILTER (WHERE status='processing'),
      'oldestPendingSeconds',coalesce(extract(epoch FROM v_now - min(updated_at) FILTER (WHERE status='processing')),0),
      'enteredLastHour',count(*) FILTER (WHERE created_at >= v_now - interval '1 hour'),
      'reenteredLastHour',NULL,'retriesLastHour',NULL,
      'completedLastHour',count(*) FILTER (WHERE status IN ('paid','completed') AND updated_at >= v_now - interval '1 hour'),
      'reviewRequired',count(*) FILTER (WHERE status='processing'),'sampleCount',count(*),'unavailableReason',NULL)
  ) INTO v_withdrawal_queues
  FROM public.withdrawal_requests
  WHERE status IN ('pending','pending_second_approval','hold','overdue','processing')
    OR updated_at >= v_now - interval '1 hour';
  v_queues := v_queues || v_withdrawal_queues;

  -- One aggregate pass each for wallets and attributions avoids repeated full scans.
  -- The only additional affiliate/order join is restricted to confirmed refunds.
  -- This runs on the shared 60-second refresh under the existing four-second timeout.
  WITH wallet_totals AS (
    SELECT
      coalesce(sum(pending_earnings_sen),0)::numeric AS wallet_pending_sen,
      coalesce(sum(earnings_sen),0)::numeric AS available_sen,
      coalesce(sum(reserved_earnings_sen),0)::numeric AS reserved_sen
    FROM public.wallets
  ), attribution_totals AS (
    SELECT
      coalesce(sum(round(commission_amount * 100)) FILTER (WHERE status='pending' AND hold_until IS NULL),0)::numeric AS affiliate_pending_sen,
      coalesce(sum(round(commission_amount * 100)) FILTER (WHERE status='confirmed'),0)::numeric AS affiliate_reward_cost_sen
    FROM public.affiliate_attributions
  ), post_maturity AS (
    SELECT coalesce(sum(round(attribution.commission_amount * 100)),0)::numeric AS exposure_sen
    FROM public.affiliate_attributions attribution
    JOIN public.orders order_row ON order_row.id=attribution.order_id
    WHERE attribution.status='confirmed' AND lower(order_row.status)='refunded'
  ), recommendation_totals AS (
    SELECT coalesce(sum(round(amount * 100)),0)::numeric AS reward_cost_sen
    FROM public.recommendation_commissions WHERE status='confirmed'
  ), payout_totals AS (
    SELECT coalesce(sum(round(payout_fee * 100)),0)::numeric AS fees_sen
    FROM public.withdrawal_requests WHERE status IN ('paid','completed')
  ), refund_totals AS (
    SELECT coalesce(sum(shortfall_sen),0)::numeric AS clawback_shortfall_sen
    FROM public.settlement_clawback_shortfalls
  )
  SELECT jsonb_build_object(
    'liabilities',jsonb_build_object(
      'pendingEarnings',wallet.wallet_pending_sen + attribution.affiliate_pending_sen,
      'availableEarnings',wallet.available_sen,
      'reservedEarnings',wallet.reserved_sen
    ),
    'economics',jsonb_build_object(
      'refundClawbackShortfall',refund.clawback_shortfall_sen,
      'postMaturityExposure',maturity.exposure_sen,
      'stackedRewardCost',attribution.affiliate_reward_cost_sen + recommendation.reward_cost_sen,
      'payoutFees',payout.fees_sen,
      'netMargin',NULL
    )
  ) INTO v_totals
  FROM wallet_totals wallet CROSS JOIN attribution_totals attribution
  CROSS JOIN post_maturity maturity CROSS JOIN recommendation_totals recommendation
  CROSS JOIN payout_totals payout CROSS JOIN refund_totals refund;
  v_liabilities := v_totals->'liabilities';
  v_economics := v_totals->'economics';

  SELECT jsonb_build_object(
    'resolved',count(*) FILTER (WHERE action IN ('released','rejected')),
    'released',count(*) FILTER (WHERE action='released'),
    'rejected',count(*) FILTER (WHERE action='rejected')
  ) INTO v_review FROM public.affiliate_guest_commission_review_events
    WHERE created_at >= v_now - interval '1 hour';

  v_result := jsonb_build_object('computedAt',v_now,'windowStart',v_now - interval '1 hour','windowEnd',v_now,
    'availability','partial','unavailableReasons',jsonb_build_array('cash_and_net_margin_sources_unavailable'),'queues',v_queues,
    'liabilitiesSen',v_liabilities,'economicsSen',v_economics,'fraudReviewSample',v_review,'cashAvailableSen',NULL);
  INSERT INTO app_private.financial_health_snapshot(singleton,snapshot,computed_at)
    VALUES(true,v_result,v_now)
    ON CONFLICT(singleton) DO UPDATE SET snapshot=EXCLUDED.snapshot,computed_at=EXCLUDED.computed_at;
  RETURN v_result;
END;
$$;

-- Invalidate snapshots created by 20261025102035, which used the old
-- `pendingRewards` JSON key, so readers refresh into the `pendingEarnings` contract.
UPDATE app_private.financial_health_snapshot
SET computed_at = to_timestamp(0)
WHERE singleton;
