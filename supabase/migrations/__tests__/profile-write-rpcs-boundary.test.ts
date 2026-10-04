import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("profile write RPC boundary migration", () => {
  it("keeps profile writes scoped to self/admin and preserves the original implementation", () => {
    const sql = migration("private_profile_write_rpcs");

    for (const name of ["clear_phone_verification", "promote_to_profile_complete"]) {
      expect(sql).toMatch(new RegExp(`ALTER FUNCTION public\\.${name}\\(uuid\\) SET SCHEMA app_private`, "i"));
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(p_user_id uuid\\)[\\s\\S]*?RETURNS void[\\s\\S]*?VOLATILE[\\s\\S]*?SECURITY INVOKER`, "i"));
      expect(sql).toContain(`IF auth.uid() IS DISTINCT FROM p_user_id AND NOT public.is_admin(auth.uid()) THEN`);
      expect(sql).toContain(`PERFORM app_private.${name}(p_user_id)`);
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION app_private\\.${name}\\(uuid\\) TO authenticated, service_role`, "i"));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(uuid\\) FROM PUBLIC, anon`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(uuid\\) TO authenticated, service_role`, "i"));
    }
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
