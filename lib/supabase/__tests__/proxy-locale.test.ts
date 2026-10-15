import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { updateSession } from "../proxy";

type ProxySetup = {
  accountLocale?: string | null;
  claimsSub?: string;
  authCookies?: Array<{ name: string; value: string; options?: Record<string, unknown> }>;
  authHeaders?: Record<string, string>;
};

function setupSupabase({
  accountLocale = null,
  claimsSub,
  authCookies = [],
  authHeaders = {},
}: ProxySetup = {}) {
  const maybeSingle = vi.fn(async () => ({
    data: accountLocale === undefined ? null : { preferred_locale: accountLocale },
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getClaims = vi.fn(async () => {
    const cookies = mocks.createServerClient.mock.calls.at(-1)?.[2]?.cookies;
    await cookies?.setAll(authCookies, authHeaders);
    return { data: claimsSub ? { claims: { sub: claimsSub } } : { claims: null }, error: null };
  });

  mocks.createServerClient.mockReturnValue({
    auth: { getClaims },
    from,
  });

  return { eq, from, getClaims, maybeSingle, select };
}

function makeRequest({ cookie, acceptLanguage }: { cookie?: string; acceptLanguage?: string } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (acceptLanguage) headers.set("accept-language", acceptLanguage);
  return new NextRequest(new Request("https://mywisata.example/customer", { headers }));
}

function localeFromResponse(response: Response) {
  return response.headers.get("x-middleware-request-x-app-locale");
}

describe("Supabase proxy locale resolution", () => {
  afterEach(() => {
    mocks.createServerClient.mockReset();
    vi.unstubAllEnvs();
  });

  it('preserves the localhost KYC MFA route in explicit legacy mode instead of redirecting to undeployed Passkey', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MYWISATA_DEMO_TOOLS', 'true');
    vi.stubEnv('MYWISATA_LOCAL_LEGACY_STAFF_AUTH', 'true');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    setupSupabase({ claimsSub: '11111111-1111-4111-8111-111111111111' });
    const response = await updateSession(new NextRequest('http://localhost:3000/admin/kyc/mfa'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not honor local compatibility on a production server', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MYWISATA_DEMO_TOOLS', 'true');
    vi.stubEnv('MYWISATA_LOCAL_LEGACY_STAFF_AUTH', 'true');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    setupSupabase({ claimsSub: '11111111-1111-4111-8111-111111111111' });
    const response = await updateSession(new NextRequest('http://localhost:3000/api/admin/kyc/submissions'));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MFA_REQUIRED" } });
  });

  it("uses the authenticated account locale before the cookie and browser", async () => {
    const { eq, from, maybeSingle, select } = setupSupabase({
      accountLocale: "ms",
      claimsSub: "user-123",
    });

    const response = await updateSession(
      makeRequest({ cookie: "NEXT_LOCALE=zh-CN", acceptLanguage: "en-US" }),
    );

    expect(localeFromResponse(response)).toBe("ms");
    expect(from).toHaveBeenCalledWith("users");
    expect(select).toHaveBeenCalledWith("preferred_locale");
    expect(eq).toHaveBeenCalledWith("id", "user-123");
    expect(maybeSingle).toHaveBeenCalledOnce();
  });

  it("uses the anonymous visitor cookie before the browser", async () => {
    const { from, getClaims } = setupSupabase();

    const response = await updateSession(
      makeRequest({ cookie: "NEXT_LOCALE=zh-CN", acceptLanguage: "ms-MY" }),
    );

    expect(localeFromResponse(response)).toBe("zh-CN");
    expect(getClaims).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back to the browser language when no account or cookie exists", async () => {
    setupSupabase();

    const response = await updateSession(makeRequest({ acceptLanguage: "ms-MY,en;q=0.8" }));

    expect(localeFromResponse(response)).toBe("ms");
  });

  it("replaces an invalid locale cookie with the supported browser fallback", async () => {
    setupSupabase();

    const response = await updateSession(
      makeRequest({ cookie: "NEXT_LOCALE=xx", acceptLanguage: "zh-SG,zh;q=0.9" }),
    );

    expect(localeFromResponse(response)).toBe("zh-CN");
    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe("zh-CN");
  });

  it("keeps Supabase auth cookies and response headers when adding the locale cookie", async () => {
    setupSupabase({
      authCookies: [
        { name: "sb-project-auth-token", value: "refreshed-token", options: { path: "/" } },
      ],
      authHeaders: { "cache-control": "private, no-store" },
    });

    const response = await updateSession(makeRequest({ acceptLanguage: "en-US" }));

    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refreshed-token");
    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe("en");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
