import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("save promotion campaign draft RPC boundary migration", () => {
  it("preserves the JSONB campaign API behind an authenticated-only invoker wrapper", () => {
    const sql = migration("private_save_promotion_campaign_draft");
    const signature = "uuid, timestamp with time zone, text, text, text, text, timestamp with time zone, timestamp with time zone, text, text";

    expect(sql).toContain(`ALTER FUNCTION public.save_promotion_campaign_draft(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.save_promotion_campaign_draft\([\s\S]*?p_campaign_id uuid,[\s\S]*?p_expected_updated_at timestamp with time zone,[\s\S]*?p_title text,[\s\S]*?p_slug text,[\s\S]*?p_summary text,[\s\S]*?p_description text,[\s\S]*?p_starts_at timestamp with time zone,[\s\S]*?p_ends_at timestamp with time zone,[\s\S]*?p_poster_url text,[\s\S]*?p_operating_hours text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.save_promotion_campaign_draft\([\s\S]*?p_campaign_id,[\s\S]*?p_expected_updated_at,[\s\S]*?p_title,[\s\S]*?p_slug,[\s\S]*?p_summary,[\s\S]*?p_description,[\s\S]*?p_starts_at,[\s\S]*?p_ends_at,[\s\S]*?p_poster_url,[\s\S]*?p_operating_hours\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.save_promotion_campaign_draft(${signature}) TO authenticated`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.save_promotion_campaign_draft(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.save_promotion_campaign_draft(${signature}) TO authenticated`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.save_promotion_campaign_draft(${signature}) TO authenticated, service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION app_private.save_promotion_campaign_draft(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
