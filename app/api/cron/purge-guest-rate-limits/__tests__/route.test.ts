import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServiceClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: mocks.createServiceClient }));

import { GET } from "@/app/api/cron/purge-guest-rate-limits/route";

describe("guest rate limit purge cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    mocks.createServiceClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: 12, error: null });
  });

  it("rejects unauthenticated requests before creating a service client", async () => {
    const response = await GET(new Request("https://example.com/api/cron/purge-guest-rate-limits"));
    expect(response.status).toBe(401);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it("runs one bounded purge batch and returns only the count", async () => {
    const response = await GET(new Request("https://example.com/api/cron/purge-guest-rate-limits", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("purge_expired_guest_rate_limits", { p_batch_size: 1000 });
    await expect(response.json()).resolves.toMatchObject({ deleted: 12, batchLimit: 1000 });
  });

  it("does not return database errors or internal keys", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private db details" } });
    const response = await GET(new Request("https://example.com/api/cron/purge-guest-rate-limits", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: "purge_unavailable" });
    expect(JSON.stringify(body)).not.toContain("private db details");
    expect(JSON.stringify(body)).not.toContain("key_hash");
  });
});
