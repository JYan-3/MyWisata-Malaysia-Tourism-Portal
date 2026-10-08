import { beforeEach, describe, expect, it, vi } from "vitest";

const VENDOR_ID = "22222222-2222-4222-8222-222222222222";
const REGISTRATION_ID = "33333333-3333-4333-8333-333333333333";
const SLOT_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({ authorizeVendor: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/vendor-authorization", () => ({ authorizeVendor: mocks.authorizeVendor }));

import { POST } from "../route";

function request(body: unknown) {
  return new Request(`http://localhost/api/vendors/${VENDOR_ID}/pickup-slots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ vendorId: VENDOR_ID }) };

describe("POST vendor event pickup slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeVendor.mockResolvedValue({ ok: true, access: { authDb: { rpc: mocks.rpc } } });
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
  });

  it("lets the event vendor create and edit a recurring or date-specific time window", async () => {
    const body = { registrationId: REGISTRATION_ID, slotId: SLOT_ID, slotDate: "2026-10-08", startsAt: "10:00", endsAt: "11:30", capacity: 40 };

    const response = await POST(request(body), params);

    expect(response.status).toBe(200);
    expect(mocks.authorizeVendor).toHaveBeenCalledWith(VENDOR_ID, undefined, { allowEventVendor: true });
    expect(mocks.rpc).toHaveBeenCalledWith("save_event_pickup_slot", {
      p_registration_id: REGISTRATION_ID,
      p_slot_id: SLOT_ID,
      p_slot_date: "2026-10-08",
      p_starts_at: "10:00",
      p_ends_at: "11:30",
      p_capacity: 40,
    });
  });

  it("rejects an invalid time window before it reaches the database", async () => {
    const response = await POST(request({ registrationId: REGISTRATION_ID, slotDate: null, startsAt: "11:00", endsAt: "11:00", capacity: 40 }), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an impossible calendar date before it reaches the database", async () => {
    const response = await POST(request({ registrationId: REGISTRATION_ID, slotDate: "2026-02-31", startsAt: "10:00", endsAt: "11:30", capacity: 40 }), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces database rules that keep a saved window inside event hours", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "pickup_slot_outside_hours" } });
    const response = await POST(request({ registrationId: REGISTRATION_ID, slotDate: null, startsAt: "08:00", endsAt: "09:00", capacity: 40 }), params);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "OUTSIDE_HOURS" } });
  });
});
