import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));

import { GET } from "../route";

function request(query: string) {
  return new Request(`http://localhost/api/geocode?${query}`);
}

describe("GET /api/geocode", () => {
  beforeEach(() => {
    vi.stubEnv("ORS_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn());
    getUser.mockResolvedValue({ data: { user: { id: "customer-1" } }, error: null });
  });

  it("requires an authenticated customer session", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "expired" } });
    expect((await GET(request("q=Kuala+Lumpur"))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates bounded forward search input and fails closed without ORS configuration", async () => {
    expect((await GET(request("q=ab"))).status).toBe(422);
    expect((await GET(request(`q=${"x".repeat(201)}`))).status).toBe(422);
    expect((await GET(request("q=Kuala+Lumpur&extra=1"))).status).toBe(422);
    const unavailable = await GET(request("q=Kuala+Lumpur"));
    expect(unavailable.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps reverse lookup local when no provider is configured", async () => {
    const response = await GET(request("lat=3.139&lng=101.6869"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.results).toEqual([{ label: "3.139, 101.6869", lat: 3.139, lng: 101.6869 }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects partial or invalid coordinates", async () => {
    expect((await GET(request("lat=3.1"))).status).toBe(422);
    expect((await GET(request("lat=91&lng=101"))).status).toBe(422);
    expect((await GET(request("lat=&lng=101"))).status).toBe(422);
    expect((await GET(request("lat=%20&lng=101"))).status).toBe(422);
    expect((await GET(request("lat=3.1&lng=%20"))).status).toBe(422);
  });

  it("uses only the configured provider and limits projected results", async () => {
    vi.stubEnv("ORS_API_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [
      { geometry: { coordinates: [101.6, 3.1] }, properties: { label: "Kuala Lumpur" } },
      { geometry: { coordinates: [999, 3.1] }, properties: { label: "Invalid" } },
      { geometry: { coordinates: [101.7, 3.2] }, properties: { label: "Petaling Jaya" } },
    ] }), { status: 200, headers: { "content-type": "application/json" } })));

    const response = await GET(request("q=Kuala+Lumpur"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.results).toEqual([
      { label: "Kuala Lumpur", lat: 3.1, lng: 101.6 },
      { label: "Petaling Jaya", lat: 3.2, lng: 101.7 },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("api.openrouteservice.org");
  });

  it("rejects provider responses above the bounded payload size", async () => {
    vi.stubEnv("ORS_API_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(257 * 1024), { status: 200 })));
    expect((await GET(request("q=Kuala+Lumpur"))).status).toBe(503);
  });
});
