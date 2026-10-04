import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("order financial outcome RPC boundary migration", () => {
  it("preserves admin and provider event handling defaults", () => {
    const sql = migration("private_mark_order_financial_outcome");
    const signature = "uuid, text, uuid, text";

    expect(sql).toContain(`ALTER FUNCTION public.mark_order_financial_outcome(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.mark_order_financial_outcome\([\s\S]*?p_order_id uuid,[\s\S]*?p_status text,[\s\S]*?p_actor_id uuid DEFAULT NULL[\s\S]*?p_provider_event_id text DEFAULT NULL[\s\S]*?\)[\s\S]*?RETURNS integer[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("p_actor_id uuid DEFAULT NULL::uuid");
    expect(sql).toContain("p_provider_event_id text DEFAULT NULL::text");
    expect(sql).toMatch(/SELECT app_private\.mark_order_financial_outcome\([\s\S]*?p_order_id,[\s\S]*?p_status,[\s\S]*?p_actor_id,[\s\S]*?p_provider_event_id\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.mark_order_financial_outcome(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.mark_order_financial_outcome(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.mark_order_financial_outcome(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
