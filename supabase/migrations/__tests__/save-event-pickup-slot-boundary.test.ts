import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("save event pickup slot RPC boundary migration", () => {
  it("preserves the JSONB slot API behind the authenticated and service role invoker wrapper", () => {
    const sql = migration("private_save_event_pickup_slot")
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    const signature = "uuid, uuid, date, time without time zone, time without time zone, integer";

    expect(sql).toContain(`ALTER FUNCTION public.save_event_pickup_slot(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.save_event_pickup_slot\([\s\S]*?p_registration_id uuid,[\s\S]*?p_slot_id uuid,[\s\S]*?p_slot_date date,[\s\S]*?p_starts_at time without time zone,[\s\S]*?p_ends_at time without time zone,[\s\S]*?p_capacity integer\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.save_event_pickup_slot\([\s\S]*?p_registration_id,[\s\S]*?p_slot_id,[\s\S]*?p_slot_date,[\s\S]*?p_starts_at,[\s\S]*?p_ends_at,[\s\S]*?p_capacity\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.save_event_pickup_slot(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.save_event_pickup_slot(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.save_event_pickup_slot(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
