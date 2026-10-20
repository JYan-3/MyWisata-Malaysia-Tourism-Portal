import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  insertError: null as { code: string; message: string } | null,
  calls: [] as Array<{ op: string; payload?: unknown; filters: Array<[string, unknown]> }>,
}));

vi.mock("@/lib/staff-permissions/server", () => ({
  requireStaffPermission: vi.fn(async () => (state.denied
    ? { response: new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), { status: 403 }) }
    : { user: { id: "admin-1" } })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => {
      const call = { op: "select", payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
      state.calls.push(call);
      const chain = {
        select: () => chain,
        order: () => chain,
        insert: (payload: unknown) => { call.op = "insert"; call.payload = payload; return chain; },
        update: (payload: unknown) => { call.op = "update"; call.payload = payload; return chain; },
        eq: (column: string, value: unknown) => { call.filters.push([column, value]); return chain; },
        single: async () => ({ data: call.payload, error: call.op === "insert" ? state.insertError : null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));

const route = await import("../route");
const json = (method: string, body: unknown) => new Request("http://localhost/api/admin/hotel-amenities", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const amenity = { code: "rooftop_bar", labelEn: "Rooftop bar", labelMs: "Bar atas bumbung", labelZh: "屋顶酒吧", icon: "wine" };

describe("admin hotel amenities API", () => {
  beforeEach(() => { state.denied = false; state.insertError = null; state.calls = []; });

  it("is for catalogue reviewers only", async () => {
    state.denied = true;
    expect((await route.GET()).status).toBe(403);
    expect((await route.POST(json("POST", amenity))).status).toBe(403);
  });

  it("adds an amenity with all three labels", async () => {
    expect((await route.POST(json("POST", amenity))).status).toBe(201);
    expect(state.calls.find((call) => call.op === "insert")!.payload).toEqual({
      code: "rooftop_bar", label_en: "Rooftop bar", label_ms: "Bar atas bumbung", label_zh: "屋顶酒吧", icon: "wine",
    });
  });

  it("rejects a code with spaces or capitals and a duplicate code", async () => {
    expect((await route.POST(json("POST", { ...amenity, code: "Rooftop Bar" }))).status).toBe(422);
    state.insertError = { code: "23505", message: "duplicate key" };
    expect((await route.POST(json("POST", amenity))).status).toBe(409);
  });

  it("switches an amenity off without deleting it", async () => {
    expect((await route.PATCH(json("PATCH", { code: "wifi", isActive: false }))).status).toBe(200);
    const update = state.calls.find((call) => call.op === "update")!;
    expect(update.payload).toEqual({ is_active: false });
    expect(update.filters).toEqual([["code", "wifi"]]);
  });
});
