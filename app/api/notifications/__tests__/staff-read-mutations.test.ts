import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), staffAccess: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from })),
}));
vi.mock("@/lib/notifications/staff-access", () => ({
  requireStaffNotificationAccess: mocks.staffAccess,
}));

import { PATCH } from "../[id]/read/route";
import { POST as markAll } from "../read-all/route";

const userId = "11111111-1111-4111-8111-111111111111";

function updateQuery() {
  const query = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    then: vi.fn(),
  };
  query.then.mockImplementation((resolve: (value: { error: null }) => void) => resolve({ error: null }));
  return query;
}

describe("staff notification read mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    mocks.staffAccess.mockResolvedValue(null);
    mocks.from.mockReturnValue(updateQuery());
  });

  it("marks one staff notification read only for the signed-in user", async () => {
    const query = updateQuery();
    mocks.from.mockReturnValue(query);
    const response = await PATCH(new Request("http://localhost/api/notifications/n1/read?scope=staff"), { params: Promise.resolve({ id: "n1" }) });
    expect(response.status).toBe(200);
    expect(mocks.staffAccess).toHaveBeenCalledWith(expect.any(Object), userId);
    expect(query.eq).toHaveBeenCalledWith("id", "n1");
    expect(query.eq).toHaveBeenCalledWith("user_id", userId);
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining("withdrawal_approval_task"));
  });

  it("marks all staff notifications read only for the signed-in user", async () => {
    const query = updateQuery();
    mocks.from.mockReturnValue(query);
    const response = await markAll(new Request("http://localhost/api/notifications/read-all?scope=staff", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(mocks.staffAccess).toHaveBeenCalledWith(expect.any(Object), userId);
    expect(query.eq).toHaveBeenCalledWith("user_id", userId);
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining("withdrawal_approval_task"));
    expect(query.is).toHaveBeenCalledWith("read_at", null);
  });

  it("rejects staff read-all when the staff assurance check fails", async () => {
    mocks.staffAccess.mockResolvedValue(Response.json({ error: "staff verification required" }, { status: 403 }));
    const response = await markAll(new Request("http://localhost/api/notifications/read-all?scope=staff", { method: "POST" }));
    expect(response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
