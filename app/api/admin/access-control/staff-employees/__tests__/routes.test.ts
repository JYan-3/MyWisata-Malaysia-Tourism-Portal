import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/staff-permissions/server", () => ({ requireStaffRoleManagementSuperAdmin: mocks.guard }));
import { GET as list } from "../route";
import { GET as detail } from "../[userId]/route";
const userId = "22222222-2222-4222-8222-222222222222";
const assignmentId = "33333333-3333-4333-8333-333333333333";
const context = { params: Promise.resolve({ userId }) };
describe("employee access projection routes", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ db: { rpc: mocks.rpc }, response: null }); });
  it("guards listing and preview before reading data", async () => {
    mocks.guard.mockResolvedValue({ response: Response.json({}, { status: 403 }) });
    expect((await list(new Request("http://localhost"))).status).toBe(403);
    expect((await detail(new Request("http://localhost"), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("forwards validated filters with the existing default page size and strips unexpected fields", async () => {
    mocks.rpc.mockResolvedValue({ data: { items: [], total: 42, page: 2, pageSize: 25, totalPages: 2, secret: "private" } });
    const response = await list(new Request("http://localhost?search=Chen&status=active&page=2"));
    expect(mocks.rpc).toHaveBeenCalledWith("list_staff_employees", { p_search: "Chen", p_status: "active", p_page: 2, p_page_size: 25 });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
  it("previews exclusion using the target assignment and exposes no private profile fields", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: userId, name: "Chen", email: "chen@example.test", status: "active", coarseRoles: ["staff"], assignments: [], sources: [], bank: "private" } });
    const response = await detail(new Request(`http://localhost?excludedAssignmentId=${assignmentId}`), context);
    expect(mocks.rpc).toHaveBeenCalledWith("get_staff_employee_access", { p_user_id: userId, p_excluded_assignment_id: assignmentId });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
  it("rejects invalid paging and fails closed on an unavailable source projection", async () => {
    expect((await list(new Request("http://localhost?pageSize=9999"))).status).toBe(422);
    mocks.rpc.mockResolvedValue({ error: { message: "secret diagnostic" } });
    const response = await detail(new Request("http://localhost"), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret diagnostic");
  });
});
