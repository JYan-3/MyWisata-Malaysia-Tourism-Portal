import { beforeEach, describe, expect, it, vi } from "vitest";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED_AT = "2026-09-25T12:00:00.000Z";

const mocks = vi.hoisted(() => ({ requireStaffPermission: vi.fn(), rpc: vi.fn(), from: vi.fn(), tables: {} as Record<string, ReturnType<typeof query>> }));

function query(result: unknown) {
  const terminal = Promise.resolve(result);
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "in", "order"]) builder[method] = vi.fn(() => builder);
  builder.then = terminal.then.bind(terminal) as ReturnType<typeof vi.fn>;
  return builder;
}

vi.mock("@/lib/staff-permissions/server", () => ({ requireStaffPermission: mocks.requireStaffPermission }));

import * as collectionRoute from "@/app/api/admin/promotion-campaigns/route";
import * as itemRoute from "@/app/api/admin/promotion-campaigns/[id]/route";

const validCampaign = {
  title: "Double Eleven experiences",
  slug: "double-eleven-experiences",
  summary: "A limited seasonal vendor-fair event.",
  description: "Vendors register their own stalls to join this scheduled event.",
  startsAt: "2026-11-10T16:00:00.000Z",
  endsAt: "2026-11-11T16:00:00.000Z",
  posterUrl: "https://x/poster.jpg",
  operatingHours: "10:00 AM - 6:00 PM",
};

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/promotion-campaigns", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("Admin promotion campaign APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tables = {
      promotion_campaigns: query({ data: [{ id: CAMPAIGN_ID, slug: "seasonal-campaign", title: "Seasonal campaign", poster_url: "https://x/poster.jpg", operating_hours: "10:00 AM - 6:00 PM", status: "draft", updated_at: UPDATED_AT }], error: null }),
    };
    mocks.from.mockImplementation((table: string) => mocks.tables[table]);
    mocks.rpc.mockResolvedValue({ data: { id: CAMPAIGN_ID, status: "draft", updated_at: UPDATED_AT }, error: null });
    mocks.requireStaffPermission.mockResolvedValue({ db: { rpc: mocks.rpc, from: mocks.from }, user: { id: "staff-owner" }, response: null });
  });

  it("checks the dedicated permission before reading a request body or campaign table", async () => {
    const forbidden = Response.json({ data: null, error: { code: "FORBIDDEN" } }, { status: 403 });
    mocks.requireStaffPermission.mockResolvedValue({ db: {}, user: null, response: forbidden });
    const json = vi.fn().mockRejectedValue(new Error("body must not be read"));

    const response = await collectionRoute.POST({ json } as unknown as Request);
    expect(response.status).toBe(403);
    expect(mocks.requireStaffPermission).toHaveBeenCalledWith("admin.promotion_campaign.manage");
    expect(json).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("lists campaign rows, including poster and operating hours, with no offers/sources fetch", async () => {
    const response = await collectionRoute.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.campaigns[0]).toMatchObject({ id: CAMPAIGN_ID, status: "draft", poster_url: "https://x/poster.jpg", operating_hours: "10:00 AM - 6:00 PM" });
    expect(body.data.campaigns[0].offers).toBeUndefined();
    expect(body.data.sources).toBeUndefined();
    expect(mocks.requireStaffPermission).toHaveBeenCalledWith("admin.promotion_campaign.manage");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("validates campaign drafts and persists only through the database RPC", async () => {
    const response = await collectionRoute.POST(request("POST", validCampaign));

    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("save_promotion_campaign_draft", {
      p_campaign_id: null,
      p_expected_updated_at: null,
      p_title: validCampaign.title,
      p_slug: validCampaign.slug,
      p_summary: validCampaign.summary,
      p_description: validCampaign.description,
      p_starts_at: validCampaign.startsAt,
      p_ends_at: validCampaign.endsAt,
      p_poster_url: validCampaign.posterUrl,
      p_operating_hours: validCampaign.operatingHours,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects unknown fields and invalid dates before any database write", async () => {
    expect((await collectionRoute.POST(request("POST", { ...validCampaign, fakeDiscount: 99 }))).status).toBe(422);
    expect((await collectionRoute.POST(request("POST", { ...validCampaign, endsAt: validCampaign.startsAt }))).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("updates drafts with an optimistic timestamp and transitions through guarded RPCs", async () => {
    const save = await itemRoute.PATCH(request("PATCH", {
      action: "save_draft",
      campaign: { ...validCampaign, expectedUpdatedAt: UPDATED_AT },
    }), { params: Promise.resolve({ id: CAMPAIGN_ID }) });
    expect(save.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("save_promotion_campaign_draft", expect.objectContaining({
      p_campaign_id: CAMPAIGN_ID,
      p_expected_updated_at: UPDATED_AT,
      p_poster_url: validCampaign.posterUrl,
      p_operating_hours: validCampaign.operatingHours,
    }));

    mocks.rpc.mockResolvedValueOnce({ data: { id: CAMPAIGN_ID, status: "pending_approval" }, error: null });
    const submit = await itemRoute.PATCH(request("PATCH", { action: "submit", expectedUpdatedAt: UPDATED_AT }), { params: Promise.resolve({ id: CAMPAIGN_ID }) });
    expect(submit.status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("transition_promotion_campaign", {
      p_campaign_id: CAMPAIGN_ID,
      p_action: "submit",
      p_expected_updated_at: UPDATED_AT,
      p_note: null,
    });
  });

  it("requires a rejection reason and never exposes database error details", async () => {
    const invalid = await itemRoute.PATCH(request("PATCH", { action: "reject", expectedUpdatedAt: UPDATED_AT }), { params: Promise.resolve({ id: CAMPAIGN_ID }) });
    expect(invalid.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "not_authorized internal detail" } });
    const rejected = await itemRoute.PATCH(request("PATCH", { action: "approve", expectedUpdatedAt: UPDATED_AT }), { params: Promise.resolve({ id: CAMPAIGN_ID }) });
    expect(rejected.status).toBe(403);
    expect(JSON.stringify(await rejected.json())).not.toContain("internal detail");
  });

  it("maps a missing poster to a dedicated error without exposing the raw message", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "promotion_campaign_poster_required" } });
    const response = await itemRoute.PATCH(request("PATCH", { action: "submit", expectedUpdatedAt: UPDATED_AT }), { params: Promise.resolve({ id: CAMPAIGN_ID }) });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("POSTER_REQUIRED");
  });

  it("returns stable unavailable errors instead of raw database messages", async () => {
    mocks.tables.promotion_campaigns = query({ data: null, error: { message: "secret database detail" } });
    const response = await collectionRoute.GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret database detail");
  });
});
