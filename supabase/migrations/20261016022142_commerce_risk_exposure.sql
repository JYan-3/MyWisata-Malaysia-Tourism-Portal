-- Reuse the existing locked, idempotent vendor reversal on every adverse order outcome.
CREATE OR REPLACE FUNCTION public.sync_paid_order_vendor_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('paid', 'completed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.settle_order_vendor_earnings(NEW.id);
  END IF;
  IF NEW.status IN ('refunded', 'chargeback', 'fraud') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.reverse_order_vendor_settlement(NEW.id, NULL);
    UPDATE public.order_settlements
       SET status = 'reversed', reversed_amount_sen = vendor_net_sen, reversed_at = now()
     WHERE order_id = NEW.id AND is_simulated AND status <> 'reversed';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_paid_order_vendor_settlement() FROM PUBLIC, anon, authenticated;

-- Support month-range and unresolved-shortfall aggregates in the finance report.
CREATE INDEX IF NOT EXISTS settlement_clawback_shortfalls_created_at_idx
  ON public.settlement_clawback_shortfalls (created_at);
CREATE INDEX IF NOT EXISTS settlement_clawback_shortfalls_open_amount_idx
  ON public.settlement_clawback_shortfalls (shortfall_sen)
  WHERE resolved_at IS NULL;

DO $migration$
DECLARE
  d text;
  v_marker text := '''payout_fees_rm'', COALESCE(SUM(payout_fee), 0),';
  v_metrics text := $metrics$
    'vendor_clawback_shortfall_month_rm', (
      SELECT COALESCE(SUM(s.shortfall_sen), 0)::numeric / 100
      FROM public.settlement_clawback_shortfalls s
      WHERE s.created_at >= (p_period_start::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
        AND s.created_at < (v_period_end::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
    ),
    'vendor_clawback_shortfall_month_count', (
      SELECT COUNT(*)
      FROM public.settlement_clawback_shortfalls s
      WHERE s.created_at >= (p_period_start::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
        AND s.created_at < (v_period_end::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
    ),
    'vendor_clawback_open_shortfall_rm', (
      SELECT COALESCE(SUM(s.shortfall_sen), 0)::numeric / 100
      FROM public.settlement_clawback_shortfalls s
      WHERE s.resolved_at IS NULL
    ),
    'vendor_clawback_open_shortfall_count', (
      SELECT COUNT(*)
      FROM public.settlement_clawback_shortfalls s
      WHERE s.resolved_at IS NULL
    ),
$metrics$;
BEGIN
  d := pg_get_functiondef('app_private.generate_monthly_payout_report(date,text)'::regprocedure);
  IF length(d) - length(replace(d, v_marker, '')) <> length(v_marker) THEN
    RAISE EXCEPTION 'payout_report_definition_drift';
  END IF;

  d := replace(d, v_marker, v_marker || E'\n' || v_metrics);
  IF position('vendor_clawback_open_shortfall_rm' IN d) = 0 THEN
    RAISE EXCEPTION 'payout_report_patch_failed';
  END IF;
  EXECUTE d;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
