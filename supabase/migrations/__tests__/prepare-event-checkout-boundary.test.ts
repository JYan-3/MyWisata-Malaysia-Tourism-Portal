import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("event checkout RPC boundary migration", () => {
  it("preserves event slot, item, and checkout validation behind an invoker wrapper", () => {
    const sql = migration("private_prepare_event_checkout");
    const signature = "uuid, date, uuid, integer, text, text, text";

    expect(sql).toContain(`ALTER FUNCTION public.prepare_event_checkout(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.prepare_event_checkout\([\s\S]*?p_listing_id uuid,[\s\S]*?p_pickup_date date,[\s\S]*?p_slot_id uuid,[\s\S]*?p_quantity integer,[\s\S]*?p_payment_method text,[\s\S]*?p_idempotency_key text,[\s\S]*?p_request_hash text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.prepare_event_checkout\([\s\S]*?p_listing_id,[\s\S]*?p_pickup_date,[\s\S]*?p_slot_id,[\s\S]*?p_quantity,[\s\S]*?p_payment_method,[\s\S]*?p_idempotency_key,[\s\S]*?p_request_hash\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.prepare_event_checkout(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.prepare_event_checkout(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.prepare_event_checkout(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
