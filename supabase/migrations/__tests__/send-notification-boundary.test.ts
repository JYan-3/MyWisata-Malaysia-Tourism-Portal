import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("notification RPC boundary migration", () => {
  it("preserves optional body/link fields and the existing self/admin guard", () => {
    const sql = migration("private_send_notification");

    expect(sql).toMatch(/ALTER FUNCTION public\.send_notification\(uuid, character varying, character varying, text, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.send_notification\([\s\S]*?p_body text DEFAULT NULL::text,[\s\S]*?p_link text DEFAULT NULL::text[\s\S]*?\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.send_notification\(p_user_id, p_type, p_title, p_body, p_link\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.send_notification\(uuid, character varying, character varying, text, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.send_notification\(uuid, character varying, character varying, text, text\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.send_notification\(uuid, character varying, character varying, text, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
