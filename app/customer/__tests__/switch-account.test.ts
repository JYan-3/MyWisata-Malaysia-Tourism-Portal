import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("customer account switch", () => {
  it("signs out the current session before navigating to login", () => {
    const layout = readFileSync(
      resolve(process.cwd(), "app/customer/layout.tsx"),
      "utf8",
    );

    const signOutIndex = layout.indexOf("await supabase.auth.signOut()");
    const loginNavigationIndex = layout.indexOf('router.replace("/login")');

    expect(signOutIndex).toBeGreaterThan(-1);
    expect(loginNavigationIndex).toBeGreaterThan(signOutIndex);
  });
});
