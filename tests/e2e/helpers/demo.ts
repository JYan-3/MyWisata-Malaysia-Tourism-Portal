import { readFileSync } from 'node:fs';
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

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

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120_000 });
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
