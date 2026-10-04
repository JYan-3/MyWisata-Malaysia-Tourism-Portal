import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("audit and notification RPC boundary migration", () => {
  it("preserves audit defaults and recipient checks behind an invoker wrapper", () => {
    const sql = migration("private_record_audit_and_notify");
    const signature = "character varying, character varying, uuid, jsonb, jsonb, text, jsonb";

    expect(sql).toContain(`ALTER FUNCTION public.record_audit_and_notify(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.record_audit_and_notify\([\s\S]*?p_action character varying,[\s\S]*?p_entity_type character varying,[\s\S]*?p_entity_id uuid,[\s\S]*?p_before_data jsonb DEFAULT NULL,[\s\S]*?p_after_data jsonb DEFAULT NULL,[\s\S]*?p_note text DEFAULT NULL,[\s\S]*?p_notifications jsonb DEFAULT '\[\]'::jsonb\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.record_audit_and_notify\([\s\S]*?p_action,[\s\S]*?p_entity_type,[\s\S]*?p_entity_id,[\s\S]*?p_before_data,[\s\S]*?p_after_data,[\s\S]*?p_note,[\s\S]*?p_notifications\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.record_audit_and_notify(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.record_audit_and_notify(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.record_audit_and_notify(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
