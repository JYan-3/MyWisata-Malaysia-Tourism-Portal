import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261023100000_close_outlet_and_commission_client_writes.sql', 'utf8');

describe('outlet and commission client-write boundary migration', () => {
  it('removes broad commission rules access and keeps server-side read/write access', () => {
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.commission_rules FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/DROP POLICY IF EXISTS commission_rules_read ON public\.commission_rules/i);
    expect(migration).toMatch(/DROP POLICY IF EXISTS "demo_allow_all" ON public\.commission_rules/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.commission_rules TO service_role/i);
  });

  it('removes broad outlet access while retaining only the customer-facing projection', () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "demo_allow_all" ON public\.outlets/i);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.outlets FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT \([\s\S]*?address,[\s\S]*?email,[\s\S]*?operating_hours,[\s\S]*?\) ON TABLE public\.outlets TO anon, authenticated/i);
    expect(migration).not.toMatch(/review_note|reviewed_by|reviewed_at/i);
  });
});
