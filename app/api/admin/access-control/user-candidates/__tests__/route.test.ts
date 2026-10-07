import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  createServiceClient: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/entitlements/admin-guard", () => ({ requireAccessControlSuperAdmin: mocks.guard }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: mocks.createServiceClient }));

import { GET } from "@/app/api/admin/access-control/user-candidates/route";

describe("Access Control user candidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ response: null });
    mocks.createServiceClient.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ or: mocks.or });
    mocks.or.mockReturnValue({ order: mocks.order });
    mocks.order.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockResolvedValue({ data: [{
      id: "11111111-1111-4111-8111-111111111111",
      full_name: "Alex Tan",
      display_name: null,
      email: "alex@example.com",
      phone: "private",
    }], error: null });
  });

  it("denies non-Super Admin before querying users", async () => {
    mocks.guard.mockResolvedValue({ response: new Response(null, { status: 403 }) });
    expect((await GET(new Request("http://localhost/api/admin/access-control/user-candidates?search=Alex"))).status).toBe(403);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it("returns only a bounded name and email match", async () => {
    const response = await GET(new Request("http://localhost/api/admin/access-control/user-candidates?search=Alex"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("users");
    expect(mocks.select).toHaveBeenCalledWith("id,full_name,display_name,email");
    expect(mocks.limit).toHaveBeenCalledWith(20);
    expect(body.data.candidates).toEqual([{
      id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Tan",
      email: "alex@example.com",
    }]);
    expect(JSON.stringify(body)).not.toContain("private");
  });

  it("rejects an empty search without touching the database", async () => {
    expect((await GET(new Request("http://localhost/api/admin/access-control/user-candidates?search=A"))).status).toBe(422);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it("keeps dots in email searches", async () => {
    await GET(new Request("http://localhost/api/admin/access-control/user-candidates?search=name.last%40example.com"));
    expect(mocks.or).toHaveBeenCalledWith(expect.stringContaining("email.ilike.%name.last@example.com%"));
  });
});
