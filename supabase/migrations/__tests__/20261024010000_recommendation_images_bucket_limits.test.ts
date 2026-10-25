import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateRecommendationImage } from "@/lib/recommendations/submission";

const sql = readFileSync("supabase/migrations/20261024010000_recommendation_images_bucket_limits.sql", "utf8");
const limit = Number(sql.match(/file_size_limit = (\d+)/)?.[1]);
const types = [...(sql.match(/allowed_mime_types = array\[([^\]]+)\]/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]);

it("limits only the recommendation-images bucket and leaves it private", () => {
  expect(sql).toMatch(/where id = 'recommendation-images';/);
  expect(sql).not.toMatch(/public\s*=|DROP POLICY|DELETE FROM|storage\.objects/i);
});

it("matches the upload route's own size and type rule", () => {
  const image = (type: string, size: number) => ({ type, size }) as File;
  expect(types).toEqual(["image/jpeg", "image/png", "image/webp"]);
  for (const type of types) expect(validateRecommendationImage(image(type, limit))).toBeNull();
  expect(validateRecommendationImage(image("image/jpeg", limit + 1))).not.toBeNull();
  expect(validateRecommendationImage(image("image/gif", 1))).not.toBeNull();
});
