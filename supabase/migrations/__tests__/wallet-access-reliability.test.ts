import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../20261023173500_wallet_access_reliability.sql", import.meta.url), "utf8");

describe("wallet and Access Control reliability migration", () => {
  it("locks the role row, rejects stale versions, and revokes the legacy signature", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.update_staff_role_with_modules(uuid, text, text, text[], boolean, text) FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("FROM public.staff_roles WHERE id = p_role_id FOR UPDATE");
    expect(migration).toContain("v_current_updated_at IS DISTINCT FROM p_expected_updated_at");
    expect(migration).toContain("RAISE EXCEPTION 'staff_role_version_conflict'");
  });

  it("commits wallet setting writes and their audit record inside the same RPC", () => {
    const functionBody = migration.match(/CREATE OR REPLACE FUNCTION app_private\.update_wallet_settings_with_audit[\s\S]*?\$function\$;/)?.[0] ?? "";
    expect(functionBody).toContain("public.is_super_admin(v_actor)");
    expect(functionBody).toContain("INSERT INTO public.platform_settings");
    expect(functionBody).toContain("INSERT INTO public.audit_logs");
    expect(functionBody).toContain("withdrawal.min_amount_sen' AND v_value < 100");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.update_wallet_settings_with_audit(jsonb, text) TO authenticated");
  });
});
