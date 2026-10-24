import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ assurance: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/staff-assurance", () => ({ requireStaffAssurance: mocks.assurance }));

import { requireStaffNotificationAccess } from "../staff-access";

function resultQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(),
  };
  query.then.mockImplementation((resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject));
  return query;
}

describe("requireStaffNotificationAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assurance.mockResolvedValue(null);
  });

  it("requires active global staff membership after assurance", async () => {
    const profileQuery = resultQuery({ data: { status: "active" }, error: null });
    const rolesQuery = resultQuery({ data: [{ roles: { name: "approver" } }], error: null });
    mocks.from.mockImplementation((table: string) => table === "users" ? profileQuery : rolesQuery);
    const db = { from: mocks.from } as unknown as SupabaseClient;
    expect(await requireStaffNotificationAccess(db, "11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(mocks.assurance).toHaveBeenCalledWith(db);
    expect(rolesQuery.is).toHaveBeenCalledWith("vendor_id", null);
    expect(rolesQuery.is).toHaveBeenCalledWith("outlet_id", null);
  });

  it("fails closed for a user who only has vendor roles", async () => {
    mocks.from.mockImplementation((table: string) => resultQuery(table === "users"
      ? { data: { status: "active" }, error: null }
      : { data: [{ roles: { name: "vendor_owner" } }], error: null }));
    const db = { from: mocks.from } as unknown as SupabaseClient;
    const response = await requireStaffNotificationAccess(db, "11111111-1111-4111-8111-111111111111");
    expect(response?.status).toBe(403);
  });

  it("fails closed when role verification is unavailable", async () => {
    mocks.from.mockImplementation((table: string) => resultQuery(table === "users"
      ? { data: { status: "active" }, error: null }
      : { data: null, error: new Error("database unavailable") }));
    const db = { from: mocks.from } as unknown as SupabaseClient;
    const response = await requireStaffNotificationAccess(db, "11111111-1111-4111-8111-111111111111");
    expect(response?.status).toBe(503);
  });
});
