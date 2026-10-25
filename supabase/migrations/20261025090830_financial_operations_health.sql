CREATE TABLE app_private.financial_health_snapshot (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  snapshot jsonb NOT NULL,
  computed_at timestamptz NOT NULL
);
ALTER TABLE app_private.financial_health_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.financial_health_snapshot FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON app_private.financial_health_snapshot TO service_role;

CREATE INDEX IF NOT EXISTS affiliate_guest_reviews_pending_created_idx
  ON public.affiliate_guest_commission_reviews (created_at, attribution_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS affiliate_guest_review_events_created_idx
  ON public.affiliate_guest_commission_review_events (created_at, action);
CREATE INDEX IF NOT EXISTS withdrawal_requests_review_created_idx
  ON public.withdrawal_requests (created_at, id)
  WHERE status IN ('pending','pending_second_approval','hold','overdue','processing');
CREATE INDEX IF NOT EXISTS refunds_pending_created_idx
  ON public.refunds (created_at, id) WHERE status IN ('pending','approved');
CREATE INDEX IF NOT EXISTS paid_order_effects_completed_updated_idx
  ON app_private.paid_order_effects_retry_progress (updated_at)
  WHERE status = 'completed';

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

  -- Do not scan lifetime wallets, commissions, attributions, orders, or payouts
  -- on every cache refresh. Until bounded/incremental ledger aggregates exist,
  -- report these amounts as unavailable instead of creating a growing read path.
  v_liabilities := NULL;
  v_economics := NULL;

  SELECT jsonb_build_object(
    'resolved',count(*) FILTER (WHERE action IN ('released','rejected')),
    'released',count(*) FILTER (WHERE action='released'),
    'rejected',count(*) FILTER (WHERE action='rejected')
  ) INTO v_review FROM public.affiliate_guest_commission_review_events
    WHERE created_at >= v_now - interval '1 hour';

  v_result := jsonb_build_object('computedAt',v_now,'windowStart',v_now - interval '1 hour','windowEnd',v_now,
    'availability','partial','unavailableReasons',jsonb_build_array('lifetime_financial_aggregates_not_bounded'),'queues',v_queues,
    'liabilitiesSen',v_liabilities,'economicsSen',v_economics,'fraudReviewSample',v_review,'cashAvailableSen',NULL);
  INSERT INTO app_private.financial_health_snapshot(singleton,snapshot,computed_at)
    VALUES(true,v_result,v_now)
    ON CONFLICT(singleton) DO UPDATE SET snapshot=EXCLUDED.snapshot,computed_at=EXCLUDED.computed_at;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_operations_health()
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT app_private.compute_financial_operations_health() $$;
REVOKE ALL ON FUNCTION app_private.compute_financial_operations_health() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.compute_financial_operations_health() TO service_role;
REVOKE ALL ON FUNCTION public.financial_operations_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_operations_health() TO service_role;
