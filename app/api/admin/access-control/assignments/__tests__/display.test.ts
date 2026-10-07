import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  loadState: vi.fn(),
  createServiceClient: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
}));

vi.mock("@/lib/entitlements/admin-guard", () => ({ requireAccessControlSuperAdmin: mocks.guard }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock("@/app/api/admin/access-control/_shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/admin/access-control/_shared")>()),
  loadAccessControlStateResponse: mocks.loadState,
}));

import { GET } from "@/app/api/admin/access-control/assignments/route";

describe("Assignment subject display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ response: null });
    mocks.loadState.mockResolvedValue({ response: null, state: {
      generation: 1,
      assignments: [{
        id: "assignment-1",
        subject_type: "user",
        subject_id: "11111111-1111-4111-8111-111111111111",
        capability_key: "recommendation.submit",
        effect: "allow",
        starts_at: "2026-10-01T00:00:00Z",
      }],
    } });
    mocks.createServiceClient.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ in: mocks.in });
    mocks.in.mockResolvedValue({ data: [{
      id: "11111111-1111-4111-8111-111111111111",
      full_name: "Alex Tan",
      display_name: null,
      email: "alex@example.com",
    }], error: null });
  });

  it("enriches a user assignment with a readable identity after pagination", async () => {
    const response = await GET(new Request("http://localhost/api/admin/access-control/assignments?page=1&pageSize=25"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.select).toHaveBeenCalledWith("id,full_name,display_name,email");
    expect(body.data.items[0]).toMatchObject({ subjectName: "Alex Tan", subjectEmail: "alex@example.com" });
  });

  it("does not look up users when authorization fails", async () => {
    mocks.guard.mockResolvedValue({ response: new Response(null, { status: 403 }) });
    expect((await GET(new Request("http://localhost/api/admin/access-control/assignments"))).status).toBe(403);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });
});
