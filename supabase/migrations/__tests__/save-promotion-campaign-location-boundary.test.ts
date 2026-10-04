import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("save promotion campaign location RPC boundary migration", () => {
  it("preserves the JSONB location API behind authenticated and service role invoker access", () => {
    const sql = migration("private_save_promotion_campaign_location");
    const signature = "uuid, uuid, text, text, double precision, double precision, date, date, time without time zone, time without time zone";

    expect(sql).toContain(`ALTER FUNCTION public.save_promotion_campaign_location(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.save_promotion_campaign_location\([\s\S]*?p_campaign_id uuid,[\s\S]*?p_location_id uuid,[\s\S]*?p_name text,[\s\S]*?p_address text,[\s\S]*?p_lat double precision,[\s\S]*?p_lng double precision,[\s\S]*?p_starts_on date,[\s\S]*?p_ends_on date,[\s\S]*?p_opens_at time without time zone,[\s\S]*?p_closes_at time without time zone\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.save_promotion_campaign_location\([\s\S]*?p_campaign_id,[\s\S]*?p_location_id,[\s\S]*?p_name,[\s\S]*?p_address,[\s\S]*?p_lat,[\s\S]*?p_lng,[\s\S]*?p_starts_on,[\s\S]*?p_ends_on,[\s\S]*?p_opens_at,[\s\S]*?p_closes_at\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.save_promotion_campaign_location(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.save_promotion_campaign_location(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.save_promotion_campaign_location(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
