import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Seeded demo accounts (scripts/seed-*). All @demo.local users share one password.
export const DEMO_PASSWORD = 'demo123456';
export const ACCOUNTS = {
  admin: 'admin@demo.local',
  customer: 'customer@demo.local',
  customer1: 'customer1@demo.local',
  customer2: 'customer2@demo.local',
  customer3: 'customer3@demo.local',
  // Registered in the live "Heritage Walk KL" event with 3 products each.
  eventVendorA: 'owner.abdul-antiques@demo.local',
  eventVendorB: 'owner.hameediyah-restaurant@demo.local',
} as const;

/** Every row created by these specs carries this prefix so it can be found and cleaned up. */
export const TEST_PREFIX = 'E2E';

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  if (localEnv('E2E_AUTH_MODE') === 'admin-session') {
    await signInWithLocalAdminSession(page, email);
    return;
  }

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120_000 });
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 120_000 });
  if (new URL(page.url()).pathname === '/admin/security') await enterAuthenticatorCode(page, email);
}

/** Creates a local-only browser session for seeded demo accounts without submitting password auth. */
async function signInWithLocalAdminSession(page: Page, email: string) {
  expect(email.toLowerCase().endsWith('@demo.local'), 'admin-session only supports seeded @demo.local test accounts').toBe(true);

  const baseUrl = String(testInfoBaseUrl());
  const appUrl = new URL(baseUrl);
  expect(['localhost', '127.0.0.1'], 'admin-session is restricted to a local Playwright baseURL').toContain(appUrl.hostname);
  const siteUrl = localEnv('NEXT_PUBLIC_SITE_URL');
  expect(siteUrl, 'NEXT_PUBLIC_SITE_URL must be set for local admin-session mode').toBeTruthy();
  expect(['localhost', '127.0.0.1'], 'NEXT_PUBLIC_SITE_URL must point to localhost').toContain(new URL(siteUrl!).hostname);

  const supabaseUrl = localEnv('NEXT_PUBLIC_SUPABASE_URL');
  const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] : undefined;
  expect(projectRef, 'admin-session requires a Supabase cloud project URL').toBeTruthy();
  expect(localEnv('E2E_TEST_DB_CONFIRM'), 'confirm the exact isolated Supabase project before creating a session').toBe(projectRef);
  expect(supabaseUrl, 'admin-session requires the canonical Supabase HTTPS URL').toBe(`https://${projectRef}.supabase.co`);

  const serviceKey = localEnv('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = localEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  expect(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY is required in the local test environment').toBeTruthy();
  expect(anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required in the local test environment').toBeTruthy();

  const service = createClient(supabaseUrl!, serviceKey!, { auth: { autoRefreshToken: false, persistSession: false } });
  const generated = await service.auth.admin.generateLink({ type: 'magiclink', email });
  expect(generated.error, 'Supabase could not create a test session').toBeNull();
  expect(generated.data.user?.email?.toLowerCase(), 'session target must be the requested seeded demo account').toBe(email.toLowerCase());
  const tokenHash = generated.data.properties?.hashed_token;
  expect(tokenHash, 'Supabase did not return a one-time session token').toBeTruthy();

  const cookieValues = new Map<string, { value: string; options: CookieOptions }>();
  const authenticated = createServerClient(supabaseUrl!, anonKey!, {
    cookies: {
      getAll: () => [...cookieValues].map(([name, cookie]) => ({ name, value: cookie.value })),
      setAll: (cookies) => { for (const { name, value, options } of cookies) cookieValues.set(name, { value, options }); },
    },
  });
  const verified = await authenticated.auth.verifyOtp({ token_hash: tokenHash!, type: 'magiclink' });
  expect(verified.error, 'Supabase could not verify the one-time test session').toBeNull();
  expect(verified.data.user?.email?.toLowerCase()).toBe(email.toLowerCase());
  expect(verified.data.session, 'Supabase did not return an authenticated session').toBeTruthy();

  const cookies: Parameters<BrowserContext['addCookies']>[0] = [...cookieValues].map(([name, cookie]) => {
    const result: Parameters<BrowserContext['addCookies']>[0][number] = { name, value: cookie.value, domain: appUrl.hostname, path: cookie.options.path ?? '/' };
    if (cookie.options.httpOnly !== undefined) result.httpOnly = cookie.options.httpOnly;
    if (cookie.options.secure !== undefined) result.secure = cookie.options.secure;
    if (typeof cookie.options.expires === 'number') result.expires = cookie.options.expires;
    if (cookie.options.sameSite) {
      const sameSite = String(cookie.options.sameSite).toLowerCase();
      result.sameSite = sameSite === 'strict' ? 'Strict' : sameSite === 'none' ? 'None' : 'Lax';
    }
    return result;
  });
  await page.context().addCookies(cookies);
  const { data: roleRows, error: roleError } = await service
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', verified.data.user!.id);
  expect(roleError, 'the demo account role could not be resolved for the MFA boundary').toBeNull();
  type RoleRow = { roles: { name: string } | Array<{ name: string }> | null };
  const roleNames = ((roleRows ?? []) as unknown as RoleRow[]).flatMap((row) => {
    if (Array.isArray(row.roles)) return row.roles.map((role) => role.name);
    return row.roles?.name ? [row.roles.name] : [];
  });
  expect(roleNames.length, 'the seeded demo account must have an application role').toBeGreaterThan(0);

  if (roleNames.some((role) => ['admin', 'approver', 'staff', 'super_admin'].includes(role))) {
    await page.goto('/admin/security');
    if (new URL(page.url()).pathname === '/admin/security') await enterAuthenticatorCode(page, email);
  }
  await page.goto('/');
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 30_000 });
}

function testInfoBaseUrl() {
  return test.info().project.use.baseURL ?? 'http://localhost:3000';
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what an authenticator app shows for this setup key. */
export function totpCode(secret: string, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * Staff sessions need an authenticator code (Docs/plans/2026-10-14-1543-staff-two-factor-login.md).
 * The setup key comes from .env.local as E2E_TOTP_<ACCOUNT>, printed by scripts/setup-staff-mfa.mjs.
 */
async function enterAuthenticatorCode(page: Page, email: string) {
  const envName = `E2E_TOTP_${email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const secret = localEnv(envName);
  if (!secret) test.skip(true, `${envName} must be set in .env.local (run scripts/setup-staff-mfa.mjs)`);
  await page.getByRole('button', { name: /set up or verify authenticator/i }).click();
  await page.locator('#kyc-mfa-code').fill(totpCode(secret!));
  await page.getByRole('button', { name: /verify and continue/i }).click();
  await page.waitForURL((url) => url.pathname !== '/admin/security', { timeout: 60_000 });
}

/** A separate signed-in browser context per role, so several accounts can act in one test. */
export async function contextFor(browser: Browser, email: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

/** Calls an API as the signed-in user of this page and returns status + JSON body. */
export async function api(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(async ({ method, url, body }) => {
    const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) as unknown };
  }, { method, url, body });
}

// Playwright empties test-results/ on every run, so screenshots live elsewhere.
export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR ?? 'e2e-shots'}/${name}.png`, fullPage: true });
}

/** A server secret for local runs: the process environment first, then .env.local (Playwright does not load it). */
export function localEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync('.env.local', 'utf8').split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  } catch {
    return undefined;
  }
}

/** Runs the 5-minute paid-order job now (Vercel cron does not run locally). */
export async function runPaidOrderJob(request: APIRequestContext) {
  const secret = localEnv('CRON_SECRET');
  expect(secret, 'CRON_SECRET must be set in .env.local to run the paid-order job').toBeTruthy();
  const response = await request.get('/api/cron/process-paid-orders', { headers: { authorization: `Bearer ${secret}` } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { processed: number; failed: number };
}

export async function expectNoServerError(page: Page) {
  await expect(page.getByText(/application error|something went wrong|internal server error/i)).toHaveCount(0);
}

export type { APIRequestContext };
