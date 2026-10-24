import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261022143000_restrict_public_outlet_and_commission_columns.sql', 'utf8');

describe('public outlet and commission rule read boundary migration', () => {
  it('removes direct client reads of commission rules while retaining service-role access', () => {
    expect(migration).toMatch(/REVOKE SELECT ON TABLE public\.commission_rules FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/DROP POLICY IF EXISTS commission_rules_read ON public\.commission_rules/i);
    expect(migration).not.toMatch(/(?:REVOKE|GRANT)[^;]*commission_rules[^;]*service_role/i);
  });

  it('grants only customer-facing outlet columns to client roles', () => {
    expect(migration).toMatch(/REVOKE SELECT ON TABLE public\.outlets FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT \([\s\S]*?address,[\s\S]*?email,[\s\S]*?operating_hours,[\s\S]*?\) ON TABLE public\.outlets TO anon, authenticated/i);
    expect(migration).not.toMatch(/review_note|reviewed_by|reviewed_at/i);
    expect(migration).not.toMatch(/DROP POLICY[^;]*public\.outlets|CREATE POLICY[^;]*public\.outlets|DELETE FROM|UPDATE public\.outlets/i);
  });
});
