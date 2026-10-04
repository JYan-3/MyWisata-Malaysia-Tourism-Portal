import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("recommendation review RPC boundary migration", () => {
  it("preserves nullable note/message defaults and the JSONB result", () => {
    const sql = migration("private_admin_review_recommendation");

    expect(sql).toMatch(/ALTER FUNCTION public\.admin_review_recommendation\(uuid, text, text, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_review_recommendation\(\s*p_rec_id uuid,\s*p_action text,\s*p_internal_note text DEFAULT NULL::text,\s*p_customer_message text DEFAULT NULL::text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.admin_review_recommendation\(\s*p_rec_id,\s*p_action,\s*p_internal_note,\s*p_customer_message\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.admin_review_recommendation\(uuid, text, text, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.admin_review_recommendation\(uuid, text, text, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_review_recommendation\(uuid, text, text, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
