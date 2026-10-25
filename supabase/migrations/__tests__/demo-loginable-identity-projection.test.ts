import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261024202041_demo_loginable_identity_projection.sql"),
  "utf8",
);

describe("loginable demo identity projection", () => {
  it("matches only seeded demo identities with an auth user and a role assignment", () => {
    expect(migration).toContain("FROM auth.users AS auth_user");
    expect(migration).toContain("JOIN public.users AS app_user ON app_user.id = auth_user.id");
    expect(migration).toContain("LIKE '%@demo.local'");
    expect(migration).toContain("JOIN public.roles AS role");
  });

  it("keeps the auth identity lookup behind a service-only public RPC", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.list_loginable_demo_user_ids() FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.list_loginable_demo_user_ids() TO service_role");
  });
});
