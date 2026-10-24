import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/staff-permissions/server", () => ({ requireStaffRoleManagementSuperAdmin: mocks.guard }));
import { GET } from "../route";
const id = "22222222-2222-4222-8222-222222222222";
describe("bounded staff candidate search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ db: { rpc: mocks.rpc }, user: { id }, response: null });
    mocks.rpc.mockResolvedValue({ data: { items: [{ id, name: "Ali Staff", email: "ali@example.test", status: "active", roles: ["staff"], phone: "private" }], total: 1, page: 1, pageSize: 25, totalPages: 1 }, error: null });
  });
  it("authorizes before database access", async () => {
    mocks.guard.mockResolvedValue({ response: Response.json({}, { status: 403 }) });
    expect((await GET(new Request("http://localhost?search=Ali"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("pushes active filtering and bounded search into the database, exposing only candidate fields", async () => {
    const response = await GET(new Request("http://localhost?search=Ali"));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("list_staff_employees", { p_search: "Ali", p_status: "active", p_page: 1, p_page_size: 25 });
    expect(await response.json()).toMatchObject({ data: { candidates: [{ id, name: "Ali Staff", email: "ali@example.test", roles: ["staff"] }] } });
  });
  it("rejects an unbounded empty search and unavailable projections", async () => {
    expect((await GET(new Request("http://localhost"))).status).toBe(422);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    const response = await GET(new Request("http://localhost?search=Ali"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
  });
});
