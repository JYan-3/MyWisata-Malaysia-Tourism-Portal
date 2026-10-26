import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  entity: {
    id: "c7712d04-8c53-4f1d-ab57-f1da28c29f2a",
    vendor_id: "4f774340-2bce-de7d-dc27-8208f1286b59",
    review_status: "pending_review",
    status: "inactive",
    updated_at: "2026-10-22T00:00:00.000Z",
  },
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcError: null as { message: string } | null,
  revalidateTag: vi.fn(),
  scheduleEmailDelivery: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: state.revalidateTag }));

vi.mock("@/lib/staff-permissions/server", () => ({
  requireStaffPermission: vi.fn(async () => ({
    user: { id: "aaaaaaaa-0000-0000-0000-000000000001" },
    db: { rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.rpcError
        ? { data: null, error: state.rpcError }
        : { data: { reviewId: "review-1", entityId: state.entity.id, entityType: "product", status: args.p_action === "approve" ? "approved" : args.p_action === "reject" ? "rejected" : "change_requested", vendorId: state.entity.vendor_id }, error: null };
    } },
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: () => ({}),
  })),
}));

vi.mock("@/lib/email/events", () => ({ scheduleEmailDelivery: state.scheduleEmailDelivery }));

import { POST } from "@/app/api/admin/catalogue/reviews/route";

describe("POST /api/admin/catalogue/reviews", () => {
  beforeEach(() => {
    state.rpcCalls = [];
    state.rpcError = null;
    state.revalidateTag.mockClear();
    state.scheduleEmailDelivery.mockClear();
  });

  it.each([
    ["approve", "approved"],
    ["reject", "rejected"],
    ["change_requested", "change_requested"],
  ])("stores the database review state for %s", async (action, expectedStoredAction) => {
    const response = await POST(new Request("http://localhost/api/admin/catalogue/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityType: "product",
        entityId: state.entity.id,
        action,
        expectedVersion: state.entity.updated_at,
        ...(action === "approve" ? {} : { note: "Please update the submitted listing." }),
      }),
    }));

    if (!response) throw new Error("The catalogue review route did not return a response");
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { review_status: string } };
    expect(payload.data.review_status).toBe(expectedStoredAction);
    expect(state.rpcCalls).toEqual([{
      name: "review_catalogue_item",
      args: {
        p_entity_type: "product",
        p_entity_id: state.entity.id,
        p_expected_updated_at: state.entity.updated_at,
        p_action: action,
        p_note: action === "approve" ? null : "Please update the submitted listing.",
      },
    }]);
    expect(state.revalidateTag).toHaveBeenCalledWith("activities", { expire: 0 });
    expect(state.scheduleEmailDelivery).toHaveBeenCalledTimes(1);
  });

  it("returns a conflict when another reviewer has already changed the task", async () => {
    state.rpcError = { message: "catalogue_item_changed" };
    const response = await POST(new Request("http://localhost/api/admin/catalogue/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityType: "product",
        entityId: state.entity.id,
        action: "approve",
        expectedVersion: state.entity.updated_at,
      }),
    }));

    if (!response) throw new Error("The catalogue review route did not return a response");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "REVIEW_CONFLICT" } });
  });
});
