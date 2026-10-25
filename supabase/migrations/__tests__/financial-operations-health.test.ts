import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../20261025090830_financial_operations_health.sql', import.meta.url),
  'utf8',
);
const lifetimeMigration = readFileSync(
  new URL('../20261025102035_financial_operations_lifetime_totals.sql', import.meta.url),
  'utf8',
);
const aggregateOptimization = readFileSync(
  new URL('../20261025102757_financial_operations_aggregate_scan_optimization.sql', import.meta.url),
  'utf8',
);
const computeFunction = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION app_private.compute_financial_operations_health()'),
  migration.indexOf('CREATE OR REPLACE FUNCTION public.financial_operations_health()'),
);

describe('financial operations health migration', () => {
  it('uses a single private short-lived snapshot and a bounded SQL statement', () => {
    expect(migration).toMatch(/CREATE TABLE app_private\.financial_health_snapshot/i);
    expect(migration).toMatch(/pg_try_advisory_xact_lock/);
    expect(migration).toMatch(/interval '60 seconds'/);
    expect(migration).toMatch(/SET statement_timeout = '4s'/i);
    expect(migration).toMatch(/cashAvailableSen',NULL/i);
    expect(migration).toMatch(/WHERE status IN \('pending','retry','processing','review_required'\)\s+OR \(status='completed' AND updated_at >= v_now - interval '1 hour'\)/i);
    expect(migration).toMatch(/paid_order_effects_completed_updated_idx/i);
    expect(migration).toMatch(/lifetime_financial_aggregates_not_bounded/i);
    expect(computeFunction).not.toMatch(/FROM public\.wallets|FROM public\.recommendation_commissions/i);
  });

  it('keeps worker and financial data behind service role execution', () => {
    expect(migration).toMatch(/REVOKE ALL ON app_private\.financial_health_snapshot FROM PUBLIC, anon, authenticated, service_role/i);
    expect(migration).toMatch(/IF COALESCE\(auth\.role\(\), ''\) <> 'service_role'/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.financial_operations_health\(\) FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.financial_operations_health\(\) TO service_role/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.compute_financial_operations_health\(\) TO service_role/i);
    expect(migration).not.toMatch(/bank_account|provider_reference|email|guest_subject_id|lease_token|storage_path/i);
  });

  it('reports only source-backed lifetime totals and keeps unsupported cash and margin unknown', () => {
    expect(lifetimeMigration).toMatch(/SET statement_timeout = '4s'/i);
    expect(lifetimeMigration).toMatch(/interval '60 seconds'/i);
    expect(lifetimeMigration).toMatch(/pendingRewards', wallet_pending_sen \+ affiliate_pending_sen/i);
    expect(lifetimeMigration).toMatch(/status='pending' AND hold_until IS NULL/i);
    expect(lifetimeMigration).toMatch(/availableEarnings', available_sen/i);
    expect(lifetimeMigration).toMatch(/reservedEarnings', reserved_sen/i);
    expect(lifetimeMigration).toMatch(/refundClawbackShortfall', refund_shortfalls_sen/i);
    expect(lifetimeMigration).toMatch(/postMaturityExposure', post_maturity_exposure_sen/i);
    expect(lifetimeMigration).toMatch(/stackedRewardCost', affiliate_reward_cost_sen \+ recommendation_reward_cost_sen/i);
    expect(lifetimeMigration).toMatch(/payoutFees', payout_fees_sen/i);
    expect(lifetimeMigration).toMatch(/'netMargin', NULL/i);
    expect(lifetimeMigration).toMatch(/'cashAvailableSen',NULL/i);
    expect(lifetimeMigration).toMatch(/cash_and_net_margin_sources_unavailable/i);
    expect(lifetimeMigration).toMatch(/IF COALESCE\(auth\.role\(\), ''\) <> 'service_role'/i);
    expect(lifetimeMigration).not.toMatch(/bank_account|provider_reference|email|guest_subject_id|lease_token|storage_path/i);
  });

  it('consolidates wallet and attribution lifetime scans in the cached RPC', () => {
    expect(aggregateOptimization).toMatch(/WITH wallet_totals AS/i);
    expect(aggregateOptimization).toMatch(/attribution_totals AS/i);
    expect(aggregateOptimization).toMatch(/post_maturity AS/i);
    expect(aggregateOptimization).toMatch(/wallet_totals wallet CROSS JOIN attribution_totals attribution/i);
    expect(aggregateOptimization).toMatch(/SET statement_timeout = '4s'/i);
    expect(aggregateOptimization).toMatch(/interval '60 seconds'/i);
    expect(aggregateOptimization).toMatch(/status='pending' AND hold_until IS NULL/i);
    expect(aggregateOptimization).toMatch(/UPDATE app_private\.financial_health_snapshot\s+SET computed_at = to_timestamp\(0\)/i);
  });
});
