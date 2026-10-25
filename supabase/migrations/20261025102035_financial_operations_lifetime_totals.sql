-- Populate supported lifetime amounts during the cached health snapshot refresh.
-- Net margin and cash stay NULL because their trusted source sets are incomplete.
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

  -- These lifetime aggregates run only during the 60-second shared refresh and
  -- are bounded by the existing four-second statement timeout. The 100k-row
  -- disposable acceptance fixture protects this growth budget.
  SELECT jsonb_build_object(
    'pendingRewards', wallet_pending_sen + affiliate_pending_sen,
    'availableEarnings', available_sen,
    'reservedEarnings', reserved_sen
  ) INTO v_liabilities FROM (
    SELECT
      coalesce((SELECT sum(pending_earnings_sen) FROM public.wallets),0)::numeric AS wallet_pending_sen,
      -- Legacy holds already occupy wallet.pending_earnings_sen; only modern
      -- uncredited attributions (hold_until IS NULL) are added separately.
      coalesce((SELECT sum(round(commission_amount * 100)) FROM public.affiliate_attributions WHERE status='pending' AND hold_until IS NULL),0)::numeric AS affiliate_pending_sen,
      coalesce((SELECT sum(earnings_sen) FROM public.wallets),0)::numeric AS available_sen,
      coalesce((SELECT sum(reserved_earnings_sen) FROM public.wallets),0)::numeric AS reserved_sen
  ) totals;

  SELECT jsonb_build_object(
    'refundClawbackShortfall', refund_shortfalls_sen,
    'postMaturityExposure', post_maturity_exposure_sen,
    'stackedRewardCost', affiliate_reward_cost_sen + recommendation_reward_cost_sen,
    'payoutFees', payout_fees_sen,
    'netMargin', NULL
  ) INTO v_economics FROM (
    SELECT
      coalesce((SELECT sum(shortfall_sen) FROM public.settlement_clawback_shortfalls),0)::numeric AS refund_shortfalls_sen,
      coalesce((SELECT sum(round(attribution.commission_amount * 100))
        FROM public.affiliate_attributions attribution
        JOIN public.orders order_row ON order_row.id=attribution.order_id
        WHERE attribution.status='confirmed' AND lower(order_row.status)='refunded'),0)::numeric AS post_maturity_exposure_sen,
      coalesce((SELECT sum(round(commission_amount * 100)) FROM public.affiliate_attributions WHERE status='confirmed'),0)::numeric AS affiliate_reward_cost_sen,
      coalesce((SELECT sum(round(amount * 100)) FROM public.recommendation_commissions WHERE status='confirmed'),0)::numeric AS recommendation_reward_cost_sen,
      coalesce((SELECT sum(round(payout_fee * 100)) FROM public.withdrawal_requests WHERE status IN ('paid','completed')),0)::numeric AS payout_fees_sen
  ) totals;

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
