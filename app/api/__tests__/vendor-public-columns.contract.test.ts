import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Users (anon + authenticated) may read only these vendor columns — see
// supabase/migrations/20260930240000_restrict_vendor_columns.sql. Rejection
// reasons, approval emails, approver and commission rate are staff-only and
// must be read through the service role after a permission check.
const USER_READABLE = [
  "id", "owner_id", "name", "slug", "description", "logo_url", "cover_url",
  "business_type", "status", "kind", "created_at", "updated_at",
];
/** Public, granted conditionally once 20260912190000_vendor_featured_products.sql is applied. */
const PENDING_PUBLIC = ["featured_product_ids"];

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(resolve(root, directory)).flatMap((name) => {
    const path = `${directory}/${name}`;
    if (name === "__tests__" || name === "node_modules") return [];
    if (statSync(resolve(root, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Top-level column names of a PostgREST select, ignoring embedded relations. */
function topLevelColumns(select: string): string[] {
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (const char of select) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter((part) => part && !part.includes("("))
    .map((part) => part.split(":").pop()!.trim());
}

const USER_CLIENT_QUERY = /(\w+(?:\.\w+)*)\s*\.from\(\s*['"]vendors['"]\s*\)\s*\.select\(\s*(['"`])([\s\S]*?)\2/g;

describe("vendor column privileges", () => {
  it("grants users exactly the documented columns", () => {
    const migration = read("supabase/migrations/20260930240000_restrict_vendor_columns.sql");
    expect(migration).toMatch(/REVOKE SELECT ON public\.vendors FROM anon, authenticated;/);
    const granted = migration.match(/GRANT SELECT \(([^)]*)\) ON public\.vendors TO anon, authenticated;/)?.[1]
      .split(",").map((column) => column.trim()).filter(Boolean);
    expect(granted?.sort()).toEqual([...USER_READABLE].sort());
    for (const column of PENDING_PUBLIC) {
      expect(migration).toContain(`GRANT SELECT (${column}) ON public.vendors TO anon, authenticated;`);
      expect(read("supabase/migrations/20260912190000_vendor_featured_products.sql")).toContain(`GRANT SELECT (${column}) ON public.vendors TO anon, authenticated;`);
    }
  });

  it("never reads withheld vendor columns through a user client", () => {
    const offenders: string[] = [];
    for (const file of ["app", "lib", "components", "backend", "hooks"].flatMap(sourceFiles)) {
      for (const match of read(file).matchAll(USER_CLIENT_QUERY)) {
        const client = match[1];
        if (/service/i.test(client)) continue;
        const denied = topLevelColumns(match[3]).filter((column) => !USER_READABLE.includes(column) && !PENDING_PUBLIC.includes(column));
        if (denied.length) offenders.push(`${file}: ${client} reads ${denied.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
