import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  recordInteraction: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/interactions", () => ({ recordInteraction: mocks.recordInteraction }));

const { POST } = await import("../route");

const CATALOGUE_UUID = "b928136e-e49d-a017-5de8-a53a651f1e34";

function request(entityId: string) {
  return new Request("http://localhost/api/interactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "view", entityType: "product", entityId, dwellMs: 250 }),
  });
}

describe("POST /api/interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "customer-demo" } } });
    mocks.recordInteraction.mockResolvedValue(undefined);
  });

  it("records canonical database UUIDs even when their version nibble is not RFC-defined", async () => {
    const response = await POST(request(CATALOGUE_UUID));

    expect(response.status).toBe(201);
    expect(mocks.recordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.any(Object) }),
      "customer-demo",
      "view",
      "product",
      CATALOGUE_UUID,
      250,
    );
  });

  it("rejects malformed entity IDs before recording an interaction", async () => {
    const response = await POST(request("not-a-database-uuid"));

    expect(response.status).toBe(422);
    expect(mocks.recordInteraction).not.toHaveBeenCalled();
  });
});
