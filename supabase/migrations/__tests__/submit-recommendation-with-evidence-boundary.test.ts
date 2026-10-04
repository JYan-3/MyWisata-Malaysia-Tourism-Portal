import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("submit recommendation with evidence RPC boundary migration", () => {
  it("preserves the complete UUID-returning API behind authenticated and service role invoker access", () => {
    const sql = migration("private_submit_recommendation_with_evidence");
    const signature = "text, text, text, uuid, text, text, text, double precision, double precision, text, text, text, uuid[]";

    expect(sql).toContain(`ALTER FUNCTION public.submit_recommendation_with_evidence(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.submit_recommendation_with_evidence\([\s\S]*?p_vendor_name text,[\s\S]*?p_description text,[\s\S]*?p_why_recommend text,[\s\S]*?p_category_id uuid,[\s\S]*?p_google_place_id text,[\s\S]*?p_location_name text,[\s\S]*?p_formatted_address text,[\s\S]*?p_latitude double precision,[\s\S]*?p_longitude double precision,[\s\S]*?p_contact_phone text,[\s\S]*?p_contact_email text,[\s\S]*?p_contact_website text,[\s\S]*?p_image_ids uuid\[\]\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.submit_recommendation_with_evidence\([\s\S]*?p_vendor_name,[\s\S]*?p_description,[\s\S]*?p_why_recommend,[\s\S]*?p_category_id,[\s\S]*?p_google_place_id,[\s\S]*?p_location_name,[\s\S]*?p_formatted_address,[\s\S]*?p_latitude,[\s\S]*?p_longitude,[\s\S]*?p_contact_phone,[\s\S]*?p_contact_email,[\s\S]*?p_contact_website,[\s\S]*?p_image_ids\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.submit_recommendation_with_evidence(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.submit_recommendation_with_evidence(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.submit_recommendation_with_evidence(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
