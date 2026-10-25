-- Report new-bucket and withdrawal state without mutating wallet balances.
-- Legacy rows remain explicitly unclassified until a verified cutover mapping exists.
CREATE OR REPLACE FUNCTION app_private.wallet_financial_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallets jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'wallet_id', w.id,
    'user_id', w.user_id,
    'stored_available_earnings_sen', w.earnings_sen,
    'ledger_available_earnings_sen', coalesce(tx.earnings_sen, 0),
    'stored_reserved_earnings_sen', w.reserved_earnings_sen,
    'open_withdrawal_requests_sen', coalesce(withdrawals.reserved_sen, 0),
    'stored_withdrawn_earnings_sen', w.withdrawn_earnings_sen,
    'completed_withdrawals_sen', coalesce(withdrawals.completed_sen, 0),
    'legacy_ledger_rows', coalesce(legacy.row_count, 0),
    'legacy_status', CASE WHEN coalesce(legacy.row_count, 0) > 0
      THEN 'legacy_unreconciled' ELSE 'no_legacy_rows_detected_cutover_unverified' END,
    'available_ledger_comparison', CASE WHEN coalesce(legacy.row_count, 0) > 0
      THEN 'unknown_legacy_unreconciled' ELSE 'unknown_cutover_unverified' END,
    'availability_matches_ledger', NULL,
    'reserved_matches_requests', w.reserved_earnings_sen = coalesce(withdrawals.reserved_sen, 0),
    'withdrawn_matches_completed', w.withdrawn_earnings_sen = coalesce(withdrawals.completed_sen, 0)
  ) ORDER BY w.id), '[]'::jsonb)
    INTO v_wallets
  FROM public.wallets AS w
  LEFT JOIN LATERAL (
    SELECT sum(CASE
      WHEN wt.bucket = 'earnings' AND wt.direction = 'credit' THEN wt.amount_sen
      WHEN wt.bucket = 'earnings' AND wt.direction = 'debit' AND wt.type <> 'withdrawal_complete' THEN -wt.amount_sen
      ELSE 0 END)::bigint AS earnings_sen
    FROM public.wallet_transactions AS wt WHERE wt.wallet_id = w.id
  ) AS tx ON true
  LEFT JOIN LATERAL (
    SELECT
      sum(round(wr.amount * 100)::bigint) FILTER (WHERE wr.status IN
        ('pending', 'pending_second_approval', 'approved', 'processing', 'hold', 'overdue'))::bigint AS reserved_sen,
      sum(round(wr.amount * 100)::bigint) FILTER (WHERE wr.status IN ('paid', 'completed'))::bigint AS completed_sen
    FROM public.withdrawal_requests AS wr WHERE wr.wallet_id = w.id
  ) AS withdrawals ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS row_count FROM public.wallet_ledger AS wl WHERE wl.wallet_id = w.id
  ) AS legacy ON true;

  RETURN jsonb_build_object(
    'wallets', v_wallets,
    'legacy_mapping', 'unknown: wallet_ledger.reference_id has no verified event-level cutover mapping to wallet_transactions.order_id/withdrawal_id',
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.wallet_financial_reconciliation() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.wallet_financial_reconciliation() TO authenticated;

CREATE OR REPLACE FUNCTION public.check_data_integrity()
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT app_private.check_data_integrity()
      || jsonb_build_object('wallet_financial_reconciliation', app_private.wallet_financial_reconciliation());
$function$;

REVOKE ALL ON FUNCTION public.check_data_integrity() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.check_data_integrity() TO authenticated;

NOTIFY pgrst, 'reload schema';
