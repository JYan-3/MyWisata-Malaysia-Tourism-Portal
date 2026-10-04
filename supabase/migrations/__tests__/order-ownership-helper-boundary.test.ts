import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("order ownership helper API boundary migration", () => {
  it("preserves policy helper OIDs and limits exposed wrappers to the caller", () => {
    const sql = migration("private_order_ownership_helpers");

    for (const name of ["order_owned_by", "order_has_vendor_item"]) {
      expect(sql).toMatch(new RegExp(`ALTER FUNCTION public\\.${name}\\(uuid, uuid\\) SET SCHEMA app_private`, "i"));
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(p_order_id uuid, p_uid uuid\\)[\\s\\S]*?STABLE[\\s\\S]*?SECURITY INVOKER`, "i"));
      expect(sql).toMatch(new RegExp(`app_private\\.${name}\\(p_order_id, p_uid\\)`, "i"));
      expect(sql).toMatch(new RegExp(`WHEN current_user = 'authenticated' AND p_uid IS DISTINCT FROM auth\\.uid\\(\\) THEN false[\\s\\S]*?app_private\\.${name}`, "i"));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(uuid, uuid\\) FROM PUBLIC, anon`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(uuid, uuid\\) TO authenticated, service_role`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION app_private\\.${name}\\(uuid, uuid\\) TO anon, authenticated, service_role`, "i"));
    }

    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
