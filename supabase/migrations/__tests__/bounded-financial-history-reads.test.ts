import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../20261025090821_bounded_financial_history_reads.sql', import.meta.url), 'utf8');

describe('bounded financial history read migration', () => {
  it('gives recommendation details a server owner scope, filtered full-set totals, keyset order and frozen cutoff', () => {
    expect(migration).toMatch(/commission\.recommender_id = v_user_id/);
    expect(migration).toMatch(/commission\.created_at <= p_snapshot_cutoff/);
    expect(migration).toMatch(/status = 'pending'/);
    expect(migration).toMatch(/ORDER BY created_at DESC, id DESC\s+LIMIT p_page_size \+ 1/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.get_recommendation_earnings_page[\s\S]*FROM PUBLIC, anon/i);
  });

  it('keeps customer affiliate history and totals inside owner-scoped SQL summaries', () => {
    expect(migration).toMatch(/public\.get_affiliate_earnings_page/);
    expect(migration).toMatch(/JOIN owner_links AS owner_link ON owner_link\.id = click\.link_id/);
    expect(migration).toMatch(/attribution\.created_at <= p_snapshot_cutoff/);
    expect(migration).toMatch(/p_page_size \+ 1/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.get_affiliate_earnings_page[\s\S]*FROM PUBLIC, anon, authenticated/i);
  });

  it('aggregates the customer dashboard and fraud analytics in the database without returning raw click identities', () => {
    expect(migration).toMatch(/public\.get_my_affiliate_dashboard_summary\(\)/);
    expect(migration).toMatch(/auth\.uid\(\)/);
    expect(migration).toMatch(/'commissions',[\s\S]*LIMIT 5/);
    expect(migration).toMatch(/public\.get_affiliate_fraud_analytics/);
    expect(migration).toMatch(/p_range NOT IN \('7d','30d','90d'\)/);
    expect(migration).not.toMatch(/'ip_hash'|'guest_subject_id'|'contact_email'/i);
  });

  it('keeps affiliate admin totals in SQL and pages filtered details with a stable cursor', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.get_affiliate_admin_summary\(\)/);
    expect(migration).toMatch(/'totalCommission',[\s\S]*'topEarners',[\s\S]*'funnel'/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.get_admin_affiliate_attribution_page/);
    expect(migration).toMatch(/attribution\.created_at <= p_snapshot_cutoff/);
    expect(migration).toMatch(/count\(\*\)::bigint AS total_count FROM filtered/);
    expect(migration).toMatch(/LIMIT p_page_size\+1/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.get_admin_affiliate_attribution_page[\s\S]*FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_admin_affiliate_attribution_page[\s\S]*TO service_role/i);
  });
});
