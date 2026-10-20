import { beforeEach, describe, expect, it, vi } from "vitest";

const SUBMISSION = "5016d273-eb84-4d20-81ab-f9022bf401fa";
const state = vi.hoisted(() => ({
  submission: null as null | { id: string; outlet_id: string; vendor_id: string; status: string; payload: unknown; outlets: { name: string } },
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  rpcError: null as null | { message: string },
  updates: [] as Array<{ table: string; payload: unknown }>,
  inserts: [] as Array<{ table: string; payload: unknown }>,
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/audit", () => ({ auditAndNotify: vi.fn(async () => undefined) }));
vi.mock("@/lib/vendor-notifications/emit", () => ({ emitVendorNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/staff-permissions/server", () => ({ requireStaffPermission: vi.fn(async () => ({ user: { id: "admin-1" } })) }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: unknown) => { state.rpcCalls.push({ name, args }); return { error: state.rpcError }; },
    from: (table: string) => {
      const chain = {
        select: () => chain, eq: () => chain, order: () => chain,
        update: (payload: unknown) => { state.updates.push({ table, payload }); return chain; },
        insert: async (payload: unknown) => { state.inserts.push({ table, payload }); return { error: null }; },
        maybeSingle: async () => ({ data: table === "hotel_profile_submissions" ? state.submission : null, error: null }),
        single: async () => ({ data: { id: SUBMISSION }, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({
          data: table === "hotel_profile_submissions" && state.submission ? [{ ...state.submission, created_at: "2026-10-18T00:00:00Z", vendors: { name: "Pelangi" }, outlets: { name: "Pelangi Beach Resort & Spa", city: "Langkawi", state: "Kedah" } }] : [],
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

const route = await import("../route");
const VERSION = "2026-10-18T07:00:00.123456+00:00";
const review = (action: string, note?: string, expectedVersion: string | undefined = VERSION) => route.POST(new Request("http://localhost/api/admin/catalogue/reviews", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ entityType: "hotel_profile", entityId: SUBMISSION, action, ...(note ? { note } : {}), ...(expectedVersion ? { expectedVersion } : {}) }),
}));

describe("admin review of hotel profiles", () => {
  beforeEach(() => {
    state.submission = { id: SUBMISSION, outlet_id: "o1", vendor_id: "v1", status: "pending_review", payload: { about: "New" }, outlets: { name: "Pelangi Beach Resort & Spa" } };
    state.rpcCalls = []; state.rpcError = null; state.updates = []; state.inserts = [];
  });

  it("approves by applying the submission atomically and never touches the outlet status", async () => {
    expect((await review("approve")).status).toBe(200);
    expect(state.rpcCalls).toEqual([{ name: "apply_hotel_profile_submission", args: { p_submission_id: SUBMISSION, p_reviewer: "admin-1", p_expected_updated_at: VERSION } }]);
    expect(state.updates.some((u) => u.table === "outlets")).toBe(false);
    expect(state.inserts).toContainEqual({ table: "content_reviews", payload: expect.objectContaining({ entity_type: "hotel_profile", action: "approved" }) });
  });

  it("rejects with a note and leaves the live hotel unchanged", async () => {
    expect((await review("reject", "Please add real photos of the rooms")).status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates).toEqual([{ table: "hotel_profile_submissions", payload: expect.objectContaining({ status: "rejected", review_note: "Please add real photos of the rooms" }) }]);
  });

  it("refuses to review a submission that is no longer pending", async () => {
    state.submission!.status = "approved";
    expect((await review("approve")).status).toBe(409);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("lists pending hotel profiles in the review queue", async () => {
    const body = await (await route.GET()).json();
    expect(body.data.items).toContainEqual(expect.objectContaining({ entityType: "hotel_profile", id: SUBMISSION, entityLabel: "Pelangi Beach Resort & Spa" }));
  });

  it("refuses to approve a version the admin did not see", async () => {
    expect((await review("approve", undefined, "")).status).toBe(422);
    state.rpcError = { message: "hotel_profile_submission_changed" };
    expect((await review("approve")).status).toBe(409);
    state.rpcError = { message: "hotel_profile_submission_not_pending" };
    expect((await review("approve")).status).toBe(409);
  });
});
