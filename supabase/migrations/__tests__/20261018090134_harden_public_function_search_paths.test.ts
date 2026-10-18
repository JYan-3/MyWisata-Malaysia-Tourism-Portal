import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261018090134_harden_public_function_search_paths.sql"),
  "utf8",
).replace(/--.*$/gm, "");

describe("public function search-path hardening migration", () => {
  it("pins both public RPC wrappers to the trusted schemas", () => {
    expect(sql).toMatch(
      /ALTER\s+FUNCTION\s+public\.apply_hotel_profile_submission\(uuid,\s*uuid,\s*timestamptz\)[\s\S]*?SET\s+search_path\s*=\s*public,\s*pg_temp/i,
    );
    expect(sql).toMatch(
      /ALTER\s+FUNCTION\s+public\.ensure_stay_nights\(integer\)[\s\S]*?SET\s+search_path\s*=\s*public,\s*pg_temp/i,
    );
  });
});
