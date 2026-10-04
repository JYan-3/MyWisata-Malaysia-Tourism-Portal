import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("admin role helper API boundary migration", () => {
  it("keeps policy helpers private while limiting signed-in RPC checks to the caller", () => {
    const sql = migration("private_admin_role_helpers");

    for (const name of ["is_admin", "is_super_admin"]) {
      expect(sql).toMatch(new RegExp(`ALTER FUNCTION public\\.${name}\\(uuid\\) SET SCHEMA app_private`, "i"));
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(uid uuid\\)[\\s\\S]*?STABLE[\\s\\S]*?SECURITY INVOKER`, "i"));
      expect(sql).toMatch(new RegExp(`app_private\\.${name}\\(uid\\)`, "i"));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION app_private\\.${name}\\(uuid\\) FROM PUBLIC`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION app_private\\.${name}\\(uuid\\) TO anon, authenticated, service_role`, "i"));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(uuid\\) FROM PUBLIC, anon`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(uuid\\) TO authenticated, service_role`, "i"));
    }

    expect(sql.match(/WHEN current_user = 'authenticated' AND uid IS DISTINCT FROM auth\.uid\(\) THEN false/gi)).toHaveLength(2);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
