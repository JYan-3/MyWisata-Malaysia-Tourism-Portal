import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const bucketPolicies = [
  ["avatar_select_public", "avatars"],
  ["event_posters_public_read", "event-posters"],
  ["place_images_public_read", "place-images"],
  ["product_images_public_read", "product-images"],
  ["vendor_images_public_read", "vendor-images"],
  ["vendor_products_public_read", "vendor-products"],
] as const;

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("public storage bucket listing policy hardening", () => {
  it("allows authenticated object reads without allowing bucket listings", () => {
    const sql = migration("restrict_public_storage_bucket_listing");

    for (const [policy, bucket] of bucketPolicies) {
      expect(sql).toContain(`ALTER POLICY ${policy} ON storage.objects`);
      expect(sql).toContain(`bucket_id = '${bucket}'`);
    }

    expect(sql).toContain("storage.allow_any_operation(ARRAY[");
    expect(sql).toContain("'object.get_authenticated_info'");
    expect(sql).toContain("'object.get_authenticated'");
    expect(sql).not.toContain("'object.list'");
  });
});
