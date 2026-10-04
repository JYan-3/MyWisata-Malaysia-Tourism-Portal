import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("transition promotion campaign RPC boundary migration", () => {
  it("preserves transition and optional note APIs behind an authenticated-only invoker wrapper", () => {
    const sql = migration("private_transition_promotion_campaign");
    const signature = "uuid, text, timestamp with time zone, text";

    expect(sql).toContain(`ALTER FUNCTION public.transition_promotion_campaign(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.transition_promotion_campaign\(\s*p_campaign_id uuid,\s*p_action text,\s*p_expected_updated_at timestamp with time zone,\s*p_note text DEFAULT NULL\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.transition_promotion_campaign\(\s*p_campaign_id,\s*p_action,\s*p_expected_updated_at,\s*p_note\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.transition_promotion_campaign(${signature}) TO authenticated`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.transition_promotion_campaign(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.transition_promotion_campaign(${signature}) TO authenticated`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.transition_promotion_campaign(${signature}) TO authenticated, service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION app_private.transition_promotion_campaign(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
