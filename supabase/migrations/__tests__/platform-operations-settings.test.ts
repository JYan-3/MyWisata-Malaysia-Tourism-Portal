import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261015062555_platform_operations_settings.sql'), 'utf8');

describe('platform operations settings migration', () => {
  it('seeds only the two fail-safe operation switches and registers a Super Admin-only module', () => {
    expect(migration).toMatch(/operations\.pause_new_orders/i);
    expect(migration).toMatch(/email\.pause_custom_delivery/i);
    expect(migration).toMatch(/\/admin\/system-settings/i);
    expect(migration).toMatch(/system_settings/i);
    expect(migration).toMatch(/ON CONFLICT/i);
  });

  it('blocks only newly inserted customer orders and keeps the trigger private', () => {
    expect(migration).toMatch(/BEFORE INSERT ON public\.orders/i);
    expect(migration).toMatch(/new_orders_paused/i);
    expect(migration).toMatch(/guest_subject_id/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION/i);
    expect(migration).toMatch(/platform_operation_setting_missing/i);
  });

  it('uses a service-only atomic settings writer with an audit row', () => {
    expect(migration).toMatch(/set_platform_operations_settings/i);
    expect(migration).toMatch(/audit_logs/i);
    expect(migration).toMatch(/active_global_super_admin_required/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION .*service_role/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION/i);
  });
});
