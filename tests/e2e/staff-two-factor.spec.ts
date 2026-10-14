import { expect, test, type Page } from '@playwright/test';
import { DEMO_PASSWORD, api, localEnv, signIn, totpCode } from './helpers/demo';

// Staff two-factor login. Plan: Docs/plans/2026-10-14-1543-staff-two-factor-login.md
// Needs E2E_TOTP_APPROVER in .env.local (scripts/setup-staff-mfa.mjs).

test.setTimeout(240_000);
test.describe.configure({ mode: 'serial', retries: 0 });
test.use({ actionTimeout: 30_000 });

const APPROVER = 'approver@demo.local';
const SUPABASE_URL = localEnv('NEXT_PUBLIC_SUPABASE_URL')!;
const ANON_KEY = localEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')!;

async function passwordOnly(page: Page, email: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => url.pathname === '/admin/security', { timeout: 120_000 });
}

test('a password alone does not open admin pages or admin APIs', async ({ page }) => {
  await passwordOnly(page, APPROVER);

  const response = await api(page, 'GET', '/api/admin/navigation/counts');
  expect(response.status).toBe(403);
  expect((response.json as { error?: { code?: string } }).error?.code).toBe('MFA_REQUIRED');

  await page.goto('/admin/withdrawals');
  await expect(page).toHaveURL(/\/admin\/security\?next=%2Fadmin%2Fwithdrawals/);
});

test('the authenticator code opens admin and returns to the requested page', async ({ page }) => {
  await signIn(page, APPROVER);
  await expect(page).not.toHaveURL(/\/admin\/security/);
  expect((await api(page, 'GET', '/api/admin/navigation/counts')).status).toBe(200);
});

test('the database refuses staff powers to a password-only session', async ({ request }) => {
  const signInRes = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY }, data: { email: APPROVER, password: DEMO_PASSWORD },
  });
  const session = await signInRes.json() as { access_token: string; user: { id: string } };
  const isAdmin = async (token: string) => (await request.post(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }, data: { uid: session.user.id },
  })).json();
  expect(await isAdmin(session.access_token), 'aal1 session (needs migration 20261015001000)').toBe(false);

  const factors = await (await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` } })).json() as { factors: { id: string; status: string }[] };
  const factorId = factors.factors.find((factor) => factor.status === 'verified')!.id;
  const auth = { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` };
  const challenge = await (await request.post(`${SUPABASE_URL}/auth/v1/factors/${factorId}/challenge`, { headers: auth, data: {} })).json() as { id: string };
  const verified = await (await request.post(`${SUPABASE_URL}/auth/v1/factors/${factorId}/verify`, {
    headers: auth, data: { challenge_id: challenge.id, code: totpCode(localEnv('E2E_TOTP_APPROVER')!) },
  })).json() as { access_token: string };
  expect(await isAdmin(verified.access_token), 'aal2 session').toBe(true);
});
