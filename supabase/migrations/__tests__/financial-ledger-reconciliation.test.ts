import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../20261025090825_financial_ledger_reconciliation.sql', import.meta.url),
  'utf8',
);

describe('financial ledger reconciliation migration', () => {
  it('preserves the existing integrity payload and adds non-mutating bucket diagnostics', () => {
    expect(migration).toMatch(/app_private\.check_data_integrity\(\)\s*\|\|\s*jsonb_build_object\('wallet_financial_reconciliation'/i);
    expect(migration).toMatch(/stored_reserved_earnings_sen/i);
    expect(migration).toMatch(/open_withdrawal_requests_sen/i);
    expect(migration).toMatch(/stored_withdrawn_earnings_sen/i);
    expect(migration).toMatch(/legacy_unreconciled/i);
    expect(migration).toMatch(/no_legacy_rows_detected_cutover_unverified/i);
    expect(migration).not.toMatch(/\b(UPDATE|INSERT|DELETE)\s+INTO\s+public\.(wallets|wallet_ledger|wallet_transactions)\b/i);
  });

  it('keeps the admin boundary and prevents direct anonymous execution', () => {
    expect(migration).toMatch(/IF NOT public\.is_admin\(auth\.uid\(\)\) THEN[\s\S]*admin_required/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION app_private\.wallet_financial_reconciliation\(\) FROM PUBLIC, anon/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.wallet_financial_reconciliation\(\) TO authenticated/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION app_private\.wallet_financial_reconciliation\(\) FROM PUBLIC, anon, service_role/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.check_data_integrity\(\) FROM PUBLIC, anon, service_role/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.check_data_integrity\(\) TO authenticated/i);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.check_data_integrity\(\) TO authenticated, service_role/i);
  });
});
