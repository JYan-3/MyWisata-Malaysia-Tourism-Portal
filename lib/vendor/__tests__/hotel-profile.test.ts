import { describe, expect, it } from "vitest";
import { hotelProfileSchema } from "@/lib/validation/vendor-schemas";
import { upsertPendingHotelProfile, isManagedHotelPhoto } from "@/lib/vendor/hotel-profile";

const profile = {
  about: "A beachfront resort.", amenityCodes: ["wifi"], checkInTime: "15:00", checkOutTime: "12:00",
  policies: "No pets.", photos: [], name: "Pelangi Beach Resort & Spa",
};

function fakeDb(pending: { id: string } | null) {
  const writes: Array<{ table: string; op: string; payload: unknown; filters: Array<[string, unknown]> }> = [];
  const db = {
    from(table: string) {
      const write = { table, op: "select", payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => { write.filters.push([column, value]); return chain; },
        maybeSingle: async () => ({ data: write.op === "select" ? pending : null, error: null }),
        single: async () => ({ data: { id: pending?.id ?? "new-id" }, error: null }),
        update: (payload: unknown) => { write.op = "update"; write.payload = payload; writes.push(write); return chain; },
        insert: (payload: unknown) => { write.op = "insert"; write.payload = payload; writes.push(write); return chain; },
      };
      return chain;
    },
  };
  return { db: db as never, writes };
}

describe("hotel profile submissions", () => {
  it("accepts a valid profile and rejects bad times", () => {
    expect(hotelProfileSchema.safeParse(profile).success).toBe(true);
    expect(hotelProfileSchema.safeParse({ ...profile, checkInTime: "3pm" }).success).toBe(false);
    expect(hotelProfileSchema.safeParse({ ...profile, checkOutTime: "24:00" }).success).toBe(false);
  });

  it("replaces the one pending submission instead of creating a second", async () => {
    const { db, writes } = fakeDb({ id: "pending-1" });
    const result = await upsertPendingHotelProfile(db, { outletId: "o1", vendorId: "v1", userId: "u1", profile });
    expect(result).toEqual({ id: "pending-1", created: false });
    expect(writes.map((w) => [w.table, w.op])).toEqual([["hotel_profile_submissions", "update"]]);
    expect(writes[0].filters).toContainEqual(["id", "pending-1"]);
  });

  it("creates a pending submission when there is none, and never writes the live outlet", async () => {
    const { db, writes } = fakeDb(null);
    const result = await upsertPendingHotelProfile(db, { outletId: "o1", vendorId: "v1", userId: "u1", profile });
    expect(result.created).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: "hotel_profile_submissions", op: "insert", payload: { outlet_id: "o1", vendor_id: "v1", submitted_by: "u1", status: "pending_review", payload: profile } });
    expect(writes.some((w) => w.table === "outlets")).toBe(false);
  });

  it("accepts only photos uploaded for this hotel", () => {
    const base = "https://x.supabase.co/storage/v1/object/public/vendor-products";
    expect(isManagedHotelPhoto(`${base}/v1/hotel/o1/a.jpg`, "v1", "o1")).toBe(true);
    expect(isManagedHotelPhoto(`${base}/v2/hotel/o1/a.jpg`, "v1", "o1")).toBe(false);
    expect(isManagedHotelPhoto(`${base}/v1/hotel/o1/../x.jpg`, "v1", "o1")).toBe(false);
    expect(isManagedHotelPhoto("https://evil.example/a.jpg", "v1", "o1")).toBe(false);
  });
});

describe("reading the live profile", () => {
  it("fails loudly instead of returning an empty profile when the database read fails", async () => {
    const { loadLiveHotelProfile, getPendingHotelProfile } = await import("@/lib/vendor/hotel-profile");
    const failing = { from: () => { const chain = { select: () => chain, eq: () => chain, is: () => chain, order: async () => ({ data: null, error: { message: "boom" } }), maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }; return chain; } };
    await expect(loadLiveHotelProfile(failing as never, "o1")).rejects.toThrow("boom");
    await expect(getPendingHotelProfile(failing as never, "o1")).rejects.toThrow("boom");
  });
});
