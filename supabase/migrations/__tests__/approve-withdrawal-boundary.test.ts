import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("legacy withdrawal approval RPC boundary migration", () => {
  it("preserves its caller binding, action API, default note, and role grants", () => {
    const sql = migration("private_approve_withdrawal");

    expect(sql).toMatch(/ALTER FUNCTION public\.approve_withdrawal\(uuid, uuid, character varying, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.approve_withdrawal\(\s*p_request_id uuid,\s*p_approver_id uuid,\s*p_action character varying,\s*p_note text DEFAULT NULL::text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.approve_withdrawal\(\s*p_request_id,\s*p_approver_id,\s*p_action,\s*p_note\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.approve_withdrawal\(uuid, uuid, character varying, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.approve_withdrawal\(uuid, uuid, character varying, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.approve_withdrawal\(uuid, uuid, character varying, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
