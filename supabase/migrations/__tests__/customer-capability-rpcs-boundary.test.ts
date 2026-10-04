import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("customer capability RPC boundary migration", () => {
  it("binds user lookups to self, preserves admin affiliate checks, and retains service access", () => {
    const sql = migration("private_customer_capability_rpcs");

    for (const name of [
      "customer_affiliate_mode",
      "customer_can_submit_recommendation",
      "customer_is_active_email_verified",
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER FUNCTION public\\.${name}\\(uuid\\) SET SCHEMA app_private`, "i"));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION app_private\\.${name}\\(uuid\\) FROM PUBLIC, anon`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION app_private\\.${name}\\(uuid\\) TO authenticated, service_role`, "i"));
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(p_user_id uuid\\)[\\s\\S]*?SECURITY INVOKER`, "i"));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(uuid\\) FROM PUBLIC, anon`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(uuid\\) TO authenticated, service_role`, "i"));
    }

    expect(sql).toContain("WHEN auth.role() = 'service_role' THEN app_private.customer_affiliate_mode(p_user_id)");
    expect(sql).toContain("WHEN auth.role() = 'authenticated' AND (p_user_id = auth.uid() OR public.is_admin(auth.uid()))");
    expect(sql).toContain("WHEN auth.role() = 'service_role' THEN app_private.customer_can_submit_recommendation(p_user_id)");
    expect(sql).toContain("WHEN auth.role() = 'authenticated' AND p_user_id = auth.uid() THEN app_private.customer_can_submit_recommendation(p_user_id)");
    expect(sql).toContain("WHEN auth.role() = 'service_role' THEN app_private.customer_is_active_email_verified(p_user_id)");
    expect(sql).toContain("WHEN auth.role() = 'authenticated' AND p_user_id = auth.uid() THEN app_private.customer_is_active_email_verified(p_user_id)");
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
