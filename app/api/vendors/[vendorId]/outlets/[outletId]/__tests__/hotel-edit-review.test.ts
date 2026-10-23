import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isHotel: false,
  isOutletManager: false,
  outletUpdates: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<{ profile: Record<string, unknown> }>,
  pending: null as null | { id: string; payload: Record<string, unknown> },
}));

vi.mock("@/lib/vendor-authorization", () => ({
  authorizeVendor: vi.fn(),
  authorizeOutlet: vi.fn(async () => ({
    ok: true,
    access: {
      userId: "u1", vendorId: "v1", isOutletManager: state.isOutletManager,
      serviceDb: {
        from: () => {
          const chain = {
            update: (payload: Record<string, unknown>) => { state.outletUpdates.push(payload); return chain; },
            eq: () => chain, select: () => chain,
            single: async () => ({ data: { id: "o1", status: "active" }, error: null }),
          };
          return chain;
        },
      },
    },
  })),
}));
vi.mock("@/lib/customer/hotel-outlet", () => ({ isHotelOutlet: vi.fn(async () => state.isHotel) }));
vi.mock("@/lib/vendor/hotel-profile", () => ({
  loadLiveHotelProfile: vi.fn(async () => ({ about: "Old", amenityCodes: ["wifi"], checkInTime: "15:00", checkOutTime: "12:00", policies: "", photos: [], name: "Old Name" })),
  getPendingHotelProfile: vi.fn(async () => state.pending),
  upsertPendingHotelProfile: vi.fn(async (_db: unknown, input: { profile: Record<string, unknown> }) => { state.upserts.push(input); return { id: "s1", created: true }; }),
}));

const route = await import("../route");
const params = { params: Promise.resolve({ vendorId: "v1", outletId: "o1" }) };
const patch = (body: unknown) => route.PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), params);

describe("outlet detail edits", () => {
  beforeEach(() => { state.isHotel = false; state.isOutletManager = false; state.outletUpdates = []; state.upserts = []; state.pending = null; });

  it("still takes a food outlet offline for review when the owner renames it", async () => {
    expect((await patch({ name: "New Food Name" })).status).toBe(200);
    expect(state.outletUpdates[0]).toMatchObject({ name: "New Food Name", review_status: "pending_review", status: "inactive" });
    expect(state.upserts).toHaveLength(0);
  });

  it("keeps a hotel live and sends its rename for review", async () => {
    state.isHotel = true;
    const response = await patch({ name: "New Hotel Name", wheelchairAccessible: true });
    expect(response.status).toBe(202);
    expect((await response.json()).data.pendingReview).toBe(true);
    expect(state.outletUpdates).toHaveLength(0);
    expect(state.upserts[0].profile).toMatchObject({ name: "New Hotel Name", about: "Old", amenityCodes: ["wifi", "accessible"] });
  });

  it("lets a hotel's outlet manager change opening hours directly", async () => {
    state.isHotel = true;
    state.isOutletManager = true;
    const hours = { mon: { open: "00:00", close: "23:59" } };
    expect((await patch({ operatingHours: hours })).status).toBe(200);
    expect(state.outletUpdates[0]).toEqual({ operating_hours: hours });
    expect(state.upserts).toHaveLength(0);
  });

  it("saves outlet badge-only changes without triggering content review", async () => {
    expect((await patch({ badgeSlugs: ["hidden_gem", "family_friendly"] })).status).toBe(200);
    expect(state.outletUpdates[0]).toEqual({ badge_slugs: ["hidden_gem", "family_friendly"] });
    expect(state.upserts).toHaveLength(0);
  });

  it("saves accommodation property types directly for hotel outlets", async () => {
    state.isHotel = true;
    expect((await patch({ accommodationTypeSlugs: ["resort"] })).status).toBe(200);
    expect(state.outletUpdates[0]).toEqual({ accommodation_type_slugs: ["resort"] });
    expect(state.upserts).toHaveLength(0);
  });

  it("rejects accommodation property types for non-hotel outlets", async () => {
    expect((await patch({ accommodationTypeSlugs: ["resort"] })).status).toBe(422);
    expect(state.outletUpdates).toHaveLength(0);
  });
});

describe("outlet update schema", () => {
  it("does not invent food service modes the vendor never sent", async () => {
    const { outletUpdateSchema } = await import("@/lib/validation/vendor-schemas");
    expect(outletUpdateSchema.parse({ operatingHours: { mon: { open: "09:00", close: "18:00" } } })).not.toHaveProperty("foodServiceModes");
    expect(outletUpdateSchema.parse({ foodServiceModes: ["takeaway"] })).toEqual({ foodServiceModes: ["takeaway"] });
  });
});

describe("outlet form feedback", () => {
  it("tells a hotel vendor their edit is under review while the hotel stays live", async () => {
    const { readFileSync } = await import("node:fs");
    const form = readFileSync(`${process.cwd()}/components/vendor/outlet-form.tsx`, "utf8");
    expect(form).toContain("res.status === 202");
    expect(form).toContain("t('outletForm.hotelPendingReview')");
  });
});

describe("hotel edits from the full outlet form", () => {
  beforeEach(() => { state.isHotel = true; state.isOutletManager = false; state.outletUpdates = []; state.upserts = []; });

  it("keeps an earlier pending change when the form re-sends the live value", async () => {
    state.pending = { id: "s1", payload: { about: "Old", amenityCodes: ["wifi", "accessible"], checkInTime: "15:00", checkOutTime: "12:00", policies: "", photos: [], name: "Pending Name" } };
    expect((await patch({ name: "Old Name", phone: "+60 4-955 1001", wheelchairAccessible: null })).status).toBe(202);
    expect(state.upserts[0].profile).toMatchObject({ name: "Pending Name", phone: "+60 4-955 1001", amenityCodes: ["wifi", "accessible"] });
  });

  it("accepts the same field lengths as the outlet form", async () => {
    const { hotelProfileSchema } = await import("@/lib/validation/vendor-schemas");
    const base = { about: "", amenityCodes: [], checkInTime: "15:00", checkOutTime: "12:00", policies: "", photos: [] };
    expect(hotelProfileSchema.safeParse({ ...base, name: "n".repeat(255), address: "a".repeat(500), city: "c".repeat(100), state: "s".repeat(100), postcode: "p".repeat(20) }).success).toBe(true);
  });
});
