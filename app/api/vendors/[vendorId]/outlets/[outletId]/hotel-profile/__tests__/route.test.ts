import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isHotel: true,
  activeCodes: ["wifi", "swimming_pool"],
  lastSubmission: null as null | { status: string; review_note: string | null; reviewed_at: string | null },
  upserts: [] as unknown[],
  outletWrites: 0,
}));

vi.mock("@/lib/vendor-authorization", () => ({
  authorizeOutlet: vi.fn(async () => ({
    ok: true,
    access: {
      userId: "u1", vendorId: "v1",
      serviceDb: {
        from: (table: string) => {
          const chain = {
            select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
            update: () => { if (table === "outlets") state.outletWrites += 1; return chain; },
            maybeSingle: async () => ({ data: table === "hotel_profile_submissions" ? state.lastSubmission : null, error: null }),
            then: (resolve: (value: unknown) => void) => resolve({ data: state.activeCodes.map((code) => ({ code, label_en: code, label_ms: code, label_zh: code, icon: "check" })), error: null }),
          };
          return chain;
        },
      },
    },
  })),
}));
vi.mock("@/lib/customer/hotel-outlet", () => ({ isHotelOutlet: vi.fn(async () => state.isHotel) }));
vi.mock("@/lib/vendor/hotel-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vendor/hotel-profile")>()),
  loadLiveHotelProfile: vi.fn(async () => ({ about: "", amenityCodes: ["wifi", "sauna_retired"], checkInTime: "15:00", checkOutTime: "12:00", policies: "", photos: [] })),
  getPendingHotelProfile: vi.fn(async () => null),
  upsertPendingHotelProfile: vi.fn(async (_db: unknown, input: unknown) => { state.upserts.push(input); return { id: "s1", created: true }; }),
}));

const route = await import("../route");
const params = { params: Promise.resolve({ vendorId: "v1", outletId: "o1" }) };
const body = { about: "A resort.", amenityCodes: ["wifi"], checkInTime: "15:00", checkOutTime: "12:00", policies: "No pets.", photos: [] };
const post = (payload: unknown) => route.POST(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), params);

describe("vendor hotel profile API", () => {
  beforeEach(() => { state.isHotel = true; state.lastSubmission = null; state.upserts = []; state.outletWrites = 0; });

  it("submits for review without touching the live outlet", async () => {
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(state.upserts).toEqual([{ outletId: "o1", vendorId: "v1", userId: "u1", profile: body }]);
    expect(state.outletWrites).toBe(0);
  });

  it("rejects an outlet that is not a hotel", async () => {
    state.isHotel = false;
    expect((await post(body)).status).toBe(409);
    expect((await route.GET(new Request("http://localhost/x"), params)).status).toBe(409);
  });

  it("rejects an unknown or inactive amenity and a badly formatted time", async () => {
    expect((await post({ ...body, amenityCodes: ["sauna"] })).status).toBe(422);
    expect((await post({ ...body, checkInTime: "3pm" })).status).toBe(422);
    expect(state.upserts).toHaveLength(0);
  });

  it("rejects photos that were not uploaded for this hotel", async () => {
    expect((await post({ ...body, photos: ["https://evil.example/a.jpg"] })).status).toBe(422);
  });

  it("returns the live profile, the pending one and the last rejection", async () => {
    state.lastSubmission = { status: "rejected", review_note: "Please add real photos", reviewed_at: "2026-10-18T00:00:00Z" };
    const json = await (await route.GET(new Request("http://localhost/x"), params)).json();
    expect(json.data.isHotel).toBe(true);
    expect(json.data.pending).toBeNull();
    expect(json.data.lastRejection).toEqual({ note: "Please add real photos", reviewedAt: "2026-10-18T00:00:00Z" });
    expect(json.data.amenities.map((a: { code: string }) => a.code)).toEqual(["wifi", "swimming_pool"]);
  });
});

describe("retired amenities", () => {
  it("are left out of the profile the editor receives, so the vendor can still submit", async () => {
    const json = await (await route.GET(new Request("http://localhost/x"), params)).json();
    expect(json.data.live.amenityCodes).toEqual(["wifi"]);
  });
});
