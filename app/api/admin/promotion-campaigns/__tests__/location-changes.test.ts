import { beforeEach, describe, expect, it, vi } from "vitest";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const UPDATED_AT = "2026-10-07T00:00:00.000Z";

const mocks = vi.hoisted(() => ({
  requireStaffPermission: vi.fn(),
  rpc: vi.fn(),
  processEmailOutbox: vi.fn(),
}));

vi.mock("@/lib/staff-permissions/server", () => ({ requireStaffPermission: mocks.requireStaffPermission }));
vi.mock("@/lib/email/outbox", () => ({ processEmailOutbox: mocks.processEmailOutbox }));

import * as previewRoute from "@/app/api/admin/promotion-campaigns/[id]/locations/[locationId]/preview/route";
import * as locationRoute from "@/app/api/admin/promotion-campaigns/[id]/locations/[locationId]/route";

const location = {
  name: "Sunway Pyramid, 2nd floor",
  address: "Jalan Lagoon, Bandar Sunway, Selangor",
  lat: 3.0738,
  lng: 101.6071,
  startsOn: "2026-10-01",
  endsOn: "2026-10-08",
  opensAt: "10:00",
  closesAt: "18:00",
};

function request(method: string, body: unknown) {
  return new Request(`http://localhost/api/admin/promotion-campaigns/${CAMPAIGN_ID}/locations/${LOCATION_ID}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: CAMPAIGN_ID, locationId: LOCATION_ID }) };

describe("protected Admin location changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStaffPermission.mockResolvedValue({
      db: { rpc: mocks.rpc },
      user: { id: "admin-1" },
      response: null,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.processEmailOutbox.mockResolvedValue({ sent: 1, failed: 0 });
  });

  it("checks permission before reading the preview body", async () => {
    const forbidden = Response.json({ data: null, error: { code: "FORBIDDEN" } }, { status: 403 });
    mocks.requireStaffPermission.mockResolvedValue({ db: {}, response: forbidden });
    const json = vi.fn().mockRejectedValue(new Error("body must not be read"));

    const response = await previewRoute.POST({ json } as unknown as Request, context);

    expect(response.status).toBe(403);
    expect(mocks.requireStaffPermission).toHaveBeenCalledWith("admin.promotion_campaign.manage");
    expect(json).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns only impact counts and blocking reasons from a preview", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        locationUpdatedAt: UPDATED_AT,
        affectedReservations: 3,
        affectedVendors: 2,
        incompatibleSlots: 1,
        blockingReasons: ["LOCATION_CHANGE_HAS_RESERVATIONS"],
        customerIds: ["customer-secret"],
        vendorIds: ["vendor-secret"],
        internalNote: "Do not expose this",
      },
      error: null,
    });

    const response = await previewRoute.POST(request("POST", { ...location, expectedUpdatedAt: UPDATED_AT, reason: "Entrance layout changed" }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      locationUpdatedAt: UPDATED_AT,
      affectedReservations: 3,
      affectedVendors: 2,
      incompatibleSlots: 1,
      blockingReasons: ["LOCATION_CHANGE_HAS_RESERVATIONS"],
    });
    expect(JSON.stringify(body)).not.toContain("customer-secret");
    expect(JSON.stringify(body)).not.toContain("vendor-secret");
    expect(JSON.stringify(body)).not.toContain("Do not expose this");
    expect(mocks.rpc).toHaveBeenCalledWith("preview_promotion_campaign_location_change", {
      p_campaign_id: CAMPAIGN_ID,
      p_location_id: LOCATION_ID,
      p_input: location,
      p_expected_updated_at: UPDATED_AT,
    });
  });

  it("maps protected save conflicts without leaking database details or sending notices", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "location_change_has_reservations secret-order-id" } });

    const response = await locationRoute.PATCH(request("PATCH", { ...location, expectedUpdatedAt: UPDATED_AT, reason: "Move the entrance" }), context);

    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("secret-order-id");
    expect(mocks.processEmailOutbox).not.toHaveBeenCalled();
  });

  it("processes the outbox only after an atomic save reports a queued notice", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { locationUpdatedAt: UPDATED_AT, notificationQueued: true }, error: null });

    const saved = await locationRoute.PATCH(request("PATCH", { ...location, expectedUpdatedAt: UPDATED_AT, reason: "Move the entrance" }), context);

    expect(saved.status).toBe(200);
    expect(mocks.processEmailOutbox).toHaveBeenCalledWith(20);

    mocks.processEmailOutbox.mockClear();
    mocks.rpc.mockResolvedValueOnce({ data: { locationUpdatedAt: UPDATED_AT, notificationQueued: false }, error: null });

    const noNotice = await locationRoute.PATCH(request("PATCH", { ...location, expectedUpdatedAt: UPDATED_AT, reason: "No vendor impact" }), context);

    expect(noNotice.status).toBe(200);
    expect(mocks.processEmailOutbox).not.toHaveBeenCalled();
  });
});
