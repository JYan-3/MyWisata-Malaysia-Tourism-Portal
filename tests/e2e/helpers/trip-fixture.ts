import {randomUUID} from 'node:crypto';
import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {localEnv} from './demo';

const SUPABASE_URL = localEnv('NEXT_PUBLIC_SUPABASE_URL')!;
const SERVICE_KEY = localEnv('SUPABASE_SERVICE_ROLE_KEY')!;
export function fixtureFetch(request:APIRequestContext): typeof fetch {
  return async (input,init)=>{
    const source=input instanceof Request ? input : null;
    const headers=Object.fromEntries(new Headers(init?.headers ?? source?.headers));
    // APIRequestContext runs in Node; never inherit the emulated browser user agent for admin Auth calls.
    headers["user-agent"]="mywisata-trip-e2e (node)";
    const method=init?.method ?? source?.method ?? 'GET';
    const url=String(source?.url ?? input);
    // Only repeat reads, exact-ID deletes, and link generation that does not send email.
    const retryable=method === 'GET' || method === 'DELETE' || new URL(url).pathname === '/auth/v1/admin/generate_link';
    for(let attempt=0;attempt<2;attempt++) {
      try {
        const response=await request.fetch(url,{method,headers,data:typeof init?.body === 'string' ? init.body : undefined,timeout:15_000});
        if(retryable && attempt === 0 && response.status() >= 500) continue;
        return new Response([204,205,304].includes(response.status()) ? null : await response.text(),{status:response.status(),headers:response.headers()});
      } catch {
        if(!retryable || attempt === 1) break;
      }
    }
    // Playwright transport exceptions include credential headers; never forward them.
    throw new Error("Trip fixture network request failed");
  };
}
function fixtureService(request:APIRequestContext) {
  return createClient(SUPABASE_URL,SERVICE_KEY,{auth:{autoRefreshToken:false,persistSession:false},global:{fetch:fixtureFetch(request)}});
}
const SERVER_HEADERS = { 'User-Agent': 'mywisata-e2e (node)', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

export type TestCustomer = { id: string; email: string; password: string };
const testCustomerIds = new Set<string>();
const testAccessTokens = new Map<string, string>();
const testCustomerTrips = new Map<string, string>();

export function confirmTestDatabase() {
  const projectRef = new URL(SUPABASE_URL).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1];
  expect(projectRef, 'Trip writes require an explicitly identified Supabase test project').toBeTruthy();
  expect(localEnv('TRIP_E2E_TEST_DB_CONFIRM'), 'Confirm the exact testing project before creating temporary records').toBe(projectRef);
  expect(['password', 'admin-session']).toContain(localEnv('TRIP_E2E_AUTH_MODE') ?? 'password');
}

export async function signInTestCustomer(page: Page, customer: TestCustomer) {
  // Synthetic acceptance must not increment the shared catalogue's paid impression metrics.
  await page.route('**/api/sponsored-placements/*/events',route=>route.fulfill({status:201,json:{data:{accepted:true}}}));
  // Header polling and weather/provider calls are outside these persistence/purchase cases.
  // Keep Auth, Trip mutations, catalogue, slot/stock reads, cart and checkout real.
  for(const pattern of ['**/api/notifications?**','**/api/support/unread-count','**/api/chat/unread-count','**/api/wishlist','**/api/saved-destinations','**/api/weather/forecast','**/api/weather/overlay']) {
    await page.route(pattern,route=>route.fulfill({status:503,json:{data:null,error:{code:'TEST_UNRELATED_SERVICE_UNAVAILABLE'}}}));
  }
  await page.route('**/api/route',route=>route.fulfill({json:{data:{routes:[]}}}));
  test.skip(localEnv('TRIP_E2E_AUTH_MODE') !== 'admin-session', 'Trip persistence E2E requires the isolated admin-session fixture so DB assertions use this run’s customer token');

  // An explicit test fixture isolates Trip persistence from provider challenges.
  // It authenticates only this run's new account and does not verify CAPTCHA login.
  expect(testCustomerIds.has(customer.id)).toBe(true);
  const applicationUrl = new URL(test.info().project.use.baseURL ?? 'http://localhost:3000');
  expect(['localhost', '127.0.0.1']).toContain(applicationUrl.hostname);
  const service=fixtureService(page.request);
  const generated = await service.auth.admin.generateLink({ type: 'magiclink', email: customer.email });
  expect(generated.error?.message).toBeUndefined();
  expect(generated.data.user?.id).toBe(customer.id);
  expect(generated.data.properties?.hashed_token).toBeTruthy();

  const cookieValues = new Map<string, string>();
  const authenticated = createServerClient(SUPABASE_URL, localEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')!, {
    global:{fetch:fixtureFetch(page.request)},
    cookies: {
      getAll: () => [...cookieValues].map(([name, value]) => ({ name, value })),
      setAll: (values) => { for (const { name, value } of values) cookieValues.set(name, value); },
    },
  });
  const verified = await authenticated.auth.verifyOtp({ token_hash: generated.data.properties!.hashed_token, type: 'magiclink' });
  expect(verified.error?.message).toBeUndefined();
  expect(verified.data.user?.id).toBe(customer.id);
  expect(verified.data.session).not.toBeNull();
  testAccessTokens.set(customer.id, verified.data.session!.access_token);
  await page.context().addCookies([...cookieValues].map(([name, value]) => ({
    name, value, url: applicationUrl.origin, sameSite: 'Lax' as const,
  })));
}

export async function createTestCustomer(tripId: string, request:APIRequestContext): Promise<TestCustomer> {
  const service=fixtureService(request);
  confirmTestDatabase();
  const email = `trip-time-${randomUUID()}@demo.local`;
  const password = `Trip-E2E-${randomUUID()}!`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Trip time slots E2E' },
  });
  if (error) throw new Error(`create a unique Trip E2E customer: ${error.name} (${error.status ?? "no status"}): ${error.message}`);
  if (!data.user) throw new Error('Supabase Auth did not return the created Trip E2E customer');
  // Register immediately so the outer finally can clean it up even if later
  // setup or assertions fail before this helper returns.
  testCustomerIds.add(data.user.id);
  testCustomerTrips.set(data.user.id, tripId);
  return { id: data.user.id, email, password };
}

export async function rest<T>(request: APIRequestContext, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<T> {
  const retryable=method === 'GET' || method === 'DELETE';
  for(let attempt=0;attempt<2;attempt++) {
    let res;
    try {
      res=await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...SERVER_HEADERS,Prefer:'return=representation'},data,timeout:15_000});
    } catch {
      if(retryable && attempt === 0) continue;
      throw new Error(`Trip fixture ${method} request failed`);
    }
    const body=await res.text();
    if(retryable && attempt === 0 && ((res.status() === 500 && body.includes('"57014"')) || (res.status() === 401 && body.includes('"PGRST303"') && body.includes('JWT issued at future')))) continue;
    expect(res.ok(),`${method} ${path}: ${res.status()} ${body}`).toBe(true);
    return (res.status() === 204 ? [] : JSON.parse(body)) as T;
  }
  throw new Error(`Trip fixture ${method} request failed`);
}

export async function cleanupTestCustomers(request: APIRequestContext) {
  const service=fixtureService(request);
  for (const customerId of testCustomerIds) {
    const tripId = testCustomerTrips.get(customerId);
    expect(tripId, 'cleanup targets only the trip registered for this test account').toBeTruthy();
    try {
      await rest(request, 'DELETE', `trips?id=eq.${tripId}&user_id=eq.${customerId}`);
      expect(await rest(request, 'GET', `trip_items?select=id&trip_id=eq.${tripId}`)).toHaveLength(0);
      const carts = await rest<{ id: string }[]>(request, 'GET', `carts?select=id&user_id=eq.${customerId}`);
      for (const cart of carts) {
        const items = await rest<{ id: string }[]>(request, 'GET', `cart_items?select=id&cart_id=eq.${cart.id}`);
        for (const item of items) await rest(request, 'DELETE', `cart_items?id=eq.${item.id}`);
        await rest(request, 'DELETE', `carts?id=eq.${cart.id}`);
        expect(await rest(request, 'GET', `cart_items?select=id&cart_id=eq.${cart.id}`)).toHaveLength(0);
      }
    } finally {
      // Keep the Auth identity available for the afterEach retry if deleting
      // its public profile fails; the two records do not share a cascade.
      await rest(request, 'DELETE', `users?id=eq.${customerId}`);
      let revocationError: string | null = null;
      const accessToken = testAccessTokens.get(customerId);
      if (accessToken) {
        try { revocationError = (await service.auth.admin.signOut(accessToken, 'global')).error?.message ?? null; }
        catch { revocationError = 'test_session_revocation_failed'; }
      }
      const { error } = await service.auth.admin.deleteUser(customerId);
      expect(!error || error.status === 404, 'delete only the registered temporary Auth customer, including cleanup retries').toBe(true);
      const remainingAuth = await service.auth.admin.getUserById(customerId);
      expect(remainingAuth.data.user).toBeNull();
      expect(remainingAuth.error?.status).toBe(404);
      for (const table of ['users', 'wallets', 'user_roles', 'carts']) {
        const key = table === 'users' ? 'id' : 'user_id';
        expect(await rest(request, 'GET', `${table}?select=${key}&${key}=eq.${customerId}`)).toHaveLength(0);
      }
      expect(await rest(request, 'GET', `trips?select=id&id=eq.${tripId}`)).toHaveLength(0);
      testAccessTokens.delete(customerId);
      testCustomerTrips.delete(customerId);
      testCustomerIds.delete(customerId);
      expect(revocationError, 'revoke the generated test session before deleting its user').toBeNull();
    }
  }
}

// Playwright gives afterEach a separate cleanup budget after a test times out.
// Use a fresh request context because the test's context may already be closed.
export function installTripFixtureCleanup() {
 test.afterEach(async ({ playwright }, testInfo) => {
  if (testCustomerIds.size === 0) return;
  testInfo.setTimeout(60_000);
  const cleanupRequest = await playwright.request.newContext({ timeout: 15_000 });
  try { await cleanupTestCustomers(cleanupRequest); }
  finally { await cleanupRequest.dispose(); }
 });
}

export function authenticatedTestDatabase(customer:TestCustomer,request:APIRequestContext) {
  confirmTestDatabase();
  const token=testAccessTokens.get(customer.id);
  expect(testCustomerIds.has(customer.id) && Boolean(token), 'only this run can use its own fixture token').toBe(true);
  return createClient(SUPABASE_URL,localEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{fetch:fixtureFetch(request),headers:{Authorization:`Bearer ${token}`}}});
}
