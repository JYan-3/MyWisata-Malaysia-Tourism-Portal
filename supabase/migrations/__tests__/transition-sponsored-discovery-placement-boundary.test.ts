import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("transition sponsored discovery placement RPC boundary migration", () => {
  it("preserves the four-argument preview-governed API behind authenticated-only invoker access", () => {
    const sql = migration("private_transition_sponsored_discovery_placement");
    const signature = "uuid, text, text, text";

    expect(sql).toContain(`ALTER FUNCTION public.transition_sponsored_discovery_placement(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.transition_sponsored_discovery_placement\(\s*p_placement_id uuid,\s*p_action text,\s*p_note text,\s*p_preview_version text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.transition_sponsored_discovery_placement\(\s*p_placement_id,\s*p_action,\s*p_note,\s*p_preview_version\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.transition_sponsored_discovery_placement(${signature}) TO authenticated`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.transition_sponsored_discovery_placement(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.transition_sponsored_discovery_placement(${signature}) TO authenticated`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.transition_sponsored_discovery_placement(${signature}) TO authenticated, service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION app_private.transition_sponsored_discovery_placement(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
