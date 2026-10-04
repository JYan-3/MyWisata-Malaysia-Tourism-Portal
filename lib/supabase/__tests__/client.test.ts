import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const { createBrowserClientSpy } = vi.hoisted(() => ({ createBrowserClientSpy: vi.fn() }));

vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();

  return {
    ...actual,
    createBrowserClient: (...args: Parameters<typeof actual.createBrowserClient>) => {
      createBrowserClientSpy(...args);
      return actual.createBrowserClient(...args);
    },
  };
});

import { createClient } from "../client";

describe("Supabase browser client Auth fetch failures", () => {
  const authUrl = "https://auth-fetch-test.supabase.co";
  const fetchMock = vi.fn<typeof fetch>();
  let client: ReturnType<typeof createClient>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", authUrl);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
    vi.stubGlobal("fetch", fetchMock);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    client = createClient();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    consoleError.mockClear();
  });

  function getConfiguredFetch() {
    const options = createBrowserClientSpy.mock.calls[0]?.[2] as {
      global?: { fetch?: typeof fetch };
    } | undefined;
    return options?.global?.fetch;
  }

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns a generic Auth error without logging a rejected getUser fetch", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await client.auth.getUser("test.jwt");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.data.user).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    expect(result.error?.status).toBe(503);
    expect(result.error?.message).toBe("Authentication service unavailable");
  });

  it("keeps rejected non-Auth Supabase requests on their original error path", async () => {
    const fetchError = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValueOnce(fetchError);
    const configuredFetch = getConfiguredFetch();

    expect(configuredFetch).toBeTypeOf("function");
    await expect(configuredFetch!("https://auth-fetch-test.supabase.co/rest/v1/places"))
      .rejects.toBe(fetchError);
  });

  it("does not intercept Auth-looking requests to another origin", async () => {
    const fetchError = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValueOnce(fetchError);
    const configuredFetch = getConfiguredFetch();

    expect(configuredFetch).toBeTypeOf("function");
    await expect(configuredFetch!("https://other.example/auth/v1/user"))
      .rejects.toBe(fetchError);
  });

  it("preserves intentional Auth request aborts", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    fetchMock.mockRejectedValueOnce(abortError);
    const configuredFetch = getConfiguredFetch();

    expect(configuredFetch).toBeTypeOf("function");
    await expect(configuredFetch!("https://auth-fetch-test.supabase.co/auth/v1/user"))
      .rejects.toBe(abortError);
  });

  it("preserves the status of an HTTP Auth error response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Invalid JWT" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await client.auth.getUser("test.jwt");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error?.status).toBe(401);
    expect(result.error?.message).toBe("Invalid JWT");
    expect(consoleError).not.toHaveBeenCalled();
  });
});
