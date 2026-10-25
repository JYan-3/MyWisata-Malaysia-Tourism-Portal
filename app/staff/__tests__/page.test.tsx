import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

describe("Staff home", () => {
  it("requires the Staff identity and renders only permission-derived destinations", () => {
    expect(source).toContain('useRequireRole(["staff"])');
    expect(source).toContain("staffModules");
    expect(source).not.toContain("staffDestinations");
    expect(source).toContain("destinations.map");
  });

  it("has an explicit zero-permission empty state", () => {
    expect(source).toContain("destinations.length === 0");
    expect(source).toContain("staffHome.empty");
  });

  it("reuses the Staff notification entry for assigned staff", () => {
    expect(source).toContain('<NotificationBell scope="staff" allHref="/admin/notifications" />');
    expect(source).toContain('staffPermissionKeys.includes("admin.withdrawal.approve")');
  });
});
