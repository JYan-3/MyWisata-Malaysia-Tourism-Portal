import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { ACCOUNTS, DEMO_PASSWORD, localEnv, signIn } from './helpers/demo';

/**
 * Black-box security checks against a running app (best against a production build:
 * `next build && next start`, so demo tools are off and the production CSP applies).
 *
 * Read-only by design: only GET requests, or requests that are rejected before any
 * work happens. It never hammers rate limits (the guest limiter is shared and would
 * lock real guests out) and never writes data.
 *
 * Results go to `${E2E_SHOTS_DIR}/security-findings.json` and the console; hard
 * expectations use expect.soft so one run reports everything.
 */

test.describe.configure({ mode: 'serial', timeout: 600_000 });
test.use({ actionTimeout: 20_000, navigationTimeout: 120_000 });

const SUPABASE_URL = localEnv('NEXT_PUBLIC_SUPABASE_URL')!;
const ANON_KEY = localEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')!;
const SERVICE_KEY = localEnv('SUPABASE_SERVICE_ROLE_KEY');
const VENDOR_A_EMAIL = 'owner.gerakbudaya-bookshop-penang@demo.local';
const VENDOR_B_EMAIL = 'owner.abdul-antiques@demo.local';
const DENIED = [401, 403, 404];
const XSS = `"><img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;
// Supabase refuses secret keys from browser-like clients; identify test setup calls as a server script.
const SERVER_UA = { 'User-Agent': 'mywisata-security-suite (node)' };

type Finding = { area: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; check: string; detail: string };
const findings: Finding[] = [];
const passed: string[] = [];
function record(ok: boolean, finding: Finding) {
  if (ok) passed.push(`${finding.area}: ${finding.check}`);
  else findings.push(finding);
}

let ids: Record<string, string | null> = {};

async function serviceSelect(request: APIRequestContext, table: string, query: string): Promise<Record<string, string>[]> {
  if (!SERVICE_KEY) return [];
  const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: { ...SERVER_UA, apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  return res.ok() ? res.json() : [];
}

async function supabaseToken(request: APIRequestContext, email: string): Promise<string | null> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    data: { email, password: DEMO_PASSWORD },
  });
  return res.ok() ? ((await res.json()) as { access_token: string }).access_token : null;
}

async function signedInPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

async function apiStatus(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const res = await fetch(path, { redirect: 'manual' });
    const text = await res.text();
    let hasData = false;
    try {
      const body = JSON.parse(text) as { data?: unknown };
      const data = body?.data;
      hasData = data !== undefined && data !== null && !(Array.isArray(data) && data.length === 0);
    } catch { hasData = text.length > 0 && res.status === 200; }
    return { status: res.status, hasData, snippet: text.slice(0, 120) };
  }, path);
}

test.beforeAll(async ({ request }) => {
  const one = async (table: string, query: string, col = 'id') => (await serviceSelect(request, table, `select=${col}&${query}&limit=1`))[0]?.[col] ?? null;
  const userId = async (email: string) => {
    if (!SERVICE_KEY) return null;
    const res = await request.get(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: { ...SERVER_UA, apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const users = res.ok() ? ((await res.json()) as { users: { id: string; email: string }[] }).users : [];
    return users.find((u) => u.email === email)?.id ?? null;
  };
  const c1 = await userId(ACCOUNTS.customer1);
  const c2 = await userId(ACCOUNTS.customer2);
  const vA = await userId(VENDOR_A_EMAIL);
  const vB = await userId(VENDOR_B_EMAIL);
  ids = {
    customer1: c1,
    customer2: c2,
    c1Trip: c1 ? await one('trips', `user_id=eq.${c1}`) : null,
    c2Order: c2 ? await one('orders', `user_id=eq.${c2}&order=created_at.desc`) : null,
    c2Ticket: c2 ? await one('support_tickets', `user_id=eq.${c2}`) : null,
    c2Thread: c2 ? await one('chat_threads', `customer_id=eq.${c2}`) : null,
    vendorA: vA ? await one('vendors', `owner_id=eq.${vA}`) : null,
    vendorB: vB ? await one('vendors', `owner_id=eq.${vB}`) : null,
  };
  ids.vendorBProduct = ids.vendorB ? await one('products', `vendor_id=eq.${ids.vendorB}`) : null;
  console.log('TARGET IDS', JSON.stringify(ids));
});

test.afterAll(() => {
  const out = process.env.E2E_SHOTS_DIR ?? 'e2e-shots';
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/security-findings.json`, JSON.stringify({ findings, passedCount: passed.length, passed }, null, 2));
  console.log(`\nSECURITY SUMMARY: ${passed.length} checks passed, ${findings.length} findings`);
  for (const f of findings) console.log(`FINDING [${f.severity}] ${f.area} — ${f.check}: ${f.detail}`);
});

test('1. signed-out visitors cannot reach protected pages or APIs', async ({ browser, request }) => {
  const page = await (await browser.newContext()).newPage();
  // /customer/* pages are open to guests by design (empty shells); their data APIs are checked below.
  for (const path of ['/admin/dashboard', '/admin/users', '/admin/withdrawals', '/vendor/dashboard', '/vendor/wallet']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const landed = new URL(page.url()).pathname;
    record(landed.startsWith('/login') || landed.startsWith('/customer/explore') || landed === '/', { area: 'access', severity: 'high', check: `signed-out ${path}`, detail: `stayed on ${landed}` });
  }
  const userApis = ['/api/affiliate/stats', '/api/affiliate/earnings-export', '/api/customer/chat', '/api/customer/vouchers', '/api/kyc/submission', '/api/notifications', '/api/profile/me', '/api/profile/survey', '/api/recommendations/earnings', '/api/saved-destinations', '/api/support/tickets', '/api/vendor/settlements', '/api/vendor/share-analytics', '/api/vendor/revenue-assistant', '/api/wallet/destinations', '/api/wallet/summary', '/api/wishlist', '/api/admin/users', '/api/admin/withdrawals', '/api/admin/kyc/submissions', '/api/admin/orders'];
  for (const path of userApis) {
    const res = await request.get(path, { maxRedirects: 0 });
    let hasData = false;
    try { const body = await res.json(); hasData = body?.data != null && !(Array.isArray(body.data) && body.data.length === 0); } catch { /* not JSON */ }
    record(DENIED.includes(res.status()) || (res.status() < 400 && !hasData), { area: 'access', severity: 'high', check: `signed-out GET ${path}`, detail: `status ${res.status()}${hasData ? ' with data' : ''}` });
  }
});

test('2. customers and vendors cannot call admin APIs', async ({ browser }) => {
  const adminApis = ['/api/admin-ai/session', '/api/admin/access-control/assignments', '/api/admin/access-control/audit-log', '/api/admin/access-control/overview', '/api/admin/access-control/staff-roles', '/api/admin/access-control/user-candidates', '/api/admin/affiliate/fraud-flags', '/api/admin/affiliate/report', '/api/admin/affiliate/stats', '/api/admin/catalogue/reviews', '/api/admin/chat-conduct-reports', '/api/admin/chat-reports', '/api/admin/chatbot/stats', '/api/admin/conduct-flags', '/api/admin/event-registrations', '/api/admin/kyc/security-status', '/api/admin/kyc/submissions', '/api/admin/moderation/flags', '/api/admin/navigation/counts', '/api/admin/orders', '/api/admin/reconciliation', '/api/admin/refunds', '/api/admin/reports/payouts', '/api/admin/tickets', '/api/admin/users', '/api/admin/vendor-fee-tiers', '/api/admin/vendors', '/api/admin/wallet-approvers', '/api/admin/wallet-settings', '/api/admin/withdrawals'];
  for (const [who, email] of [['customer', ACCOUNTS.customer1], ['vendor', VENDOR_A_EMAIL]] as const) {
    const page = await signedInPage(browser, email);
    for (const path of adminApis) {
      const r = await apiStatus(page, path);
      record(DENIED.includes(r.status) || (r.status < 400 && !r.hasData && r.status !== 200), { area: 'privilege', severity: 'critical', check: `${who} GET ${path}`, detail: `status ${r.status}${r.hasData ? ' WITH DATA' : ''}: ${r.snippet}` });
    }
    await page.context().close();
  }
});

test('3. users cannot read other users\' records (IDOR)', async ({ browser }) => {
  const c1 = await signedInPage(browser, ACCOUNTS.customer1);
  for (const [label, path] of [
    ['another customer\'s order', ids.c2Order && `/api/customer/orders/${ids.c2Order}`],
    ['another customer\'s QR passes', ids.c2Order && `/api/customer/orders/${ids.c2Order}/qr-passes`],
    ['another customer\'s support ticket', ids.c2Ticket && `/api/support/tickets/${ids.c2Ticket}`],
    ['another customer\'s chat thread', ids.c2Thread && `/api/customer/chat/${ids.c2Thread}`],
    ['a vendor API', ids.vendorA && `/api/vendors/${ids.vendorA}/orders`],
  ] as const) {
    if (!path) { findings.push({ area: 'idor', severity: 'info', check: label, detail: 'no target id found; skipped' }); continue; }
    const r = await apiStatus(c1, path);
    record(DENIED.includes(r.status) || (r.status < 400 && !r.hasData), { area: 'idor', severity: 'critical', check: `customer1 → ${label}`, detail: `status ${r.status}${r.hasData ? ' WITH DATA' : ''}` });
  }
  await c1.context().close();

  if (ids.c1Trip) {
    const c2 = await signedInPage(browser, ACCOUNTS.customer2);
    await c2.goto(`/customer/trip/${ids.c1Trip}`, { waitUntil: 'domcontentloaded' });
    await c2.waitForTimeout(6000);
    const leaked = await c2.locator('[data-trip-day], [data-trip-overview]').count();
    record(leaked === 0, { area: 'idor', severity: 'high', check: 'customer2 opens customer1\'s trip planner', detail: `${leaked} itinerary elements rendered at ${new URL(c2.url()).pathname}` });
    await c2.context().close();
  }

  const vA = await signedInPage(browser, VENDOR_A_EMAIL);
  for (const path of [`/api/vendors/${ids.vendorB}/orders`, `/api/vendors/${ids.vendorB}/products`, `/api/vendors/${ids.vendorB}/bookings`, `/api/vendors/${ids.vendorB}/vouchers`, `/api/vendors/${ids.vendorB}/products/${ids.vendorBProduct}`, `/api/vendors/${ids.vendorB}`]) {
    if (path.includes('null')) continue;
    const r = await apiStatus(vA, path);
    record(DENIED.includes(r.status) || (r.status < 400 && !r.hasData), { area: 'idor', severity: 'critical', check: `vendor A → vendor B ${path.replace(String(ids.vendorB), '{B}').replace(String(ids.vendorBProduct), '{product}')}`, detail: `status ${r.status}${r.hasData ? ' WITH DATA' : ''}` });
  }
  await vA.context().close();
});

test('4. direct database and storage access with the public key', async ({ request }) => {
  const anonSpec = await request.get(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } });
  record(!anonSpec.ok(), { area: 'database', severity: 'low', check: 'schema listing hidden from the public key', detail: `/rest/v1/ answered ${anonSpec.status()} to the public key` });
  // The table list itself comes from the secret key; every probe below uses only the public key.
  const spec = SERVICE_KEY ? await request.get(`${SUPABASE_URL}/rest/v1/`, { headers: { ...SERVER_UA, apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }) : null;
  const definitions = spec?.ok() ? ((await spec.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }> }).definitions ?? {} : {};
  const tables = Object.keys(definitions);
  expect.soft(tables.length, 'table list from the secret key (needed for the anonymous-read scan)').toBeGreaterThan(0);

  const SENSITIVE = /email|phone|ic_|nric|passport|address|bank|account_no|account_number|password|token|secret|balance|amount|_sen$|dob|birth/i;
  const anonReadable: string[] = [];
  for (const table of tables) {
    const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: ANON_KEY } });
    if (!res.ok()) continue;
    const rows = (await res.json()) as Record<string, unknown>[];
    if (rows.length === 0) continue;
    const sensitive = Object.keys(rows[0]).filter((col) => SENSITIVE.test(col));
    anonReadable.push(table);
    if (sensitive.length) findings.push({ area: 'database', severity: 'high', check: `anonymous read of ${table}`, detail: `returns rows including ${sensitive.join(', ')} — confirm this is meant to be public` });
  }
  passed.push(`database: ${tables.length - anonReadable.length} of ${tables.length} tables/views return nothing anonymously`);
  // Specific rows that must never be public, whatever their column names.
  for (const [table, query, why] of [
    ['chatbot_sessions', 'select=id&limit=1', 'guest help-bot sessions'],
    ['chatbot_messages', 'select=id,body&limit=1', 'help-bot conversation text'],
    ['vendor_event_promotions', 'select=amount_sen,stripe_checkout_session_id&limit=1', 'what vendors paid and their Stripe session ids'],
  ] as const) {
    const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: { apikey: ANON_KEY } });
    const rows = res.ok() ? ((await res.json()) as unknown[]).length : 0;
    record(rows === 0, { area: 'database', severity: 'medium', check: `anonymous read of ${table} (${why})`, detail: `${rows} row(s) returned` });
  }
  console.log('ANON-READABLE (no sensitive-looking columns are not reported):', anonReadable.join(', '));

  const token = await supabaseToken(request, ACCOUNTS.customer1);
  if (token && ids.customer1) {
    const auth = { apikey: ANON_KEY, Authorization: `Bearer ${token}` };
    const crossUser: string[] = [];
    for (const table of tables) {
      const cols = Object.keys(definitions[table]?.properties ?? {});
      const owner = ['user_id', 'customer_id'].find((c) => cols.includes(c));
      if (!owner) continue;
      const res = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=${owner}&${owner}=neq.${ids.customer1}&limit=1`, { headers: auth });
      if (res.ok() && ((await res.json()) as unknown[]).length) crossUser.push(table);
    }
    findings.push({ area: 'database', severity: 'info', check: 'tables where customer1 sees other users\' rows', detail: crossUser.length ? `${crossUser.join(', ')} — review each is public by design (reviews, public profiles)` : 'none' });
  }

  for (const bucket of ['kyc-documents', 'vendor-documents', 'chat-attachments', 'ticket-attachments', 'vendor-digital-assets', 'recommendation-images']) {
    const res = await request.post(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }, data: { prefix: '', limit: 5 } });
    const listed = res.ok() ? ((await res.json()) as unknown[]).length : 0;
    record(listed === 0, { area: 'storage', severity: 'critical', check: `anonymous listing of private bucket ${bucket}`, detail: `${listed} entries visible` });
  }

  for (const email of ['admin@demo.local', ACCOUNTS.customer1]) {
    const works = Boolean(await supabaseToken(request, email));
    record(!works, { area: 'credentials', severity: email.startsWith('admin') ? 'critical' : 'high', check: `published demo password works for ${email}`, detail: 'the password in tests/e2e/helpers/demo.ts (public repo) signs in against this database' });
  }
});

test('5. security headers and cookies', async ({ browser, request }) => {
  for (const path of ['/', '/login', '/customer/explore', '/legal/privacy', '/api/health']) {
    const res = await request.get(path, { maxRedirects: 0 });
    const h = res.headers();
    const csp = h['content-security-policy'] ?? '';
    for (const [name, ok] of [
      ['Content-Security-Policy with frame-ancestors', /frame-ancestors/.test(csp)],
      ['object-src none', /object-src 'none'/.test(csp)],
      ['X-Content-Type-Options nosniff', h['x-content-type-options'] === 'nosniff'],
      ['X-Frame-Options', Boolean(h['x-frame-options'])],
      ['Strict-Transport-Security', Boolean(h['strict-transport-security'])],
      ['Referrer-Policy', Boolean(h['referrer-policy'])],
      ['no X-Powered-By', !h['x-powered-by']],
      ['no unsafe-eval (production build)', !/unsafe-eval/.test(csp)],
    ] as const) record(ok, { area: 'headers', severity: name.startsWith('no unsafe-eval') ? 'low' : 'medium', check: `${name} on ${path}`, detail: name.includes('unsafe-eval') ? 'expected only on the dev server' : 'missing' });
  }

  const page = await signedInPage(browser, ACCOUNTS.customer1);
  const authCookies = (await page.context().cookies()).filter((c) => c.name.startsWith('sb-'));
  for (const c of authCookies) {
    record(c.sameSite === 'Lax' || c.sameSite === 'Strict', { area: 'cookies', severity: 'medium', check: `${c.name} SameSite`, detail: `SameSite=${c.sameSite}` });
    findings.push({ area: 'cookies', severity: 'info', check: `${c.name} flags`, detail: `HttpOnly=${c.httpOnly} Secure=${c.secure} SameSite=${c.sameSite} (Supabase browser auth needs script-readable cookies; XSS protection matters more)` });
  }
  await page.context().close();
});

test('6. reflected XSS through URL parameters', async ({ browser }) => {
  const page = await signedInPage(browser, ACCOUNTS.customer1);
  let dialogs = 0;
  page.on('dialog', async (d) => { dialogs += 1; await d.dismiss(); });
  const enc = encodeURIComponent(XSS);
  const targets = [`/customer/search?q=${enc}`, `/customer/explore?q=${enc}`, `/help?q=${enc}`, `/login?error=${enc}`, `/legal/privacy?x=${enc}`, `/customer/vouchers?q=${enc}`, `/${enc}`];
  for (const path of targets) {
    await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForTimeout(2500);
    const fired = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss === 1).catch(() => false);
    record(!fired, { area: 'xss', severity: 'high', check: `payload in ${path.split('?')[0]}${path.includes('?') ? '?' + path.split('?')[1].split('=')[0] : ''}`, detail: 'injected script ran' });
  }
  if (ids.vendorBProduct) {
    await page.goto(`/customer/activity/${ids.vendorBProduct}?returnTo=${encodeURIComponent('javascript:window.__xss=1')}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const jsLinks = await page.locator('a[href^="javascript:" i]').count();
    record(jsLinks === 0, { area: 'xss', severity: 'high', check: 'returnTo=javascript: on activity page', detail: `${jsLinks} javascript: links rendered` });
  }
  record(dialogs === 0, { area: 'xss', severity: 'high', check: 'no alert/confirm dialogs triggered by payloads', detail: `${dialogs} dialogs` });
  await page.context().close();
});

test('7. open redirects', async ({ browser, request }) => {
  for (const next of ['//evil.example', '/%09/evil.example', 'https://evil.example', '/\\evil.example']) {
    const res = await request.get(`/auth/callback?next=${next}`, { maxRedirects: 0 });
    const location = res.headers()['location'] ?? '';
    const host = location ? new URL(location, 'http://localhost:3000').host : 'localhost:3000';
    record(!host.includes('evil.example'), { area: 'redirect', severity: 'medium', check: `/auth/callback?next=${next}`, detail: `redirects to ${location}` });
  }
  const r = await request.get('/r/not-a-real-code?to=https://evil.example&url=https://evil.example', { maxRedirects: 0 });
  const loc = r.headers()['location'] ?? '';
  record(!loc.includes('evil.example'), { area: 'redirect', severity: 'medium', check: 'affiliate /r/<code> with an outside URL', detail: `redirects to ${loc}` });

  const page = await (await browser.newContext()).newPage();
  await page.goto(`/login?next=${encodeURIComponent('https://evil.example/steal')}`);
  await page.locator('input[type="email"]').fill(ACCOUNTS.customer1);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120_000 }).catch(() => undefined);
  record(!page.url().includes('evil.example'), { area: 'redirect', severity: 'medium', check: 'sign-in with next=https://evil.example', detail: `landed on ${page.url()}` });
  await page.context().close();
});

test('8. filter injection and error leakage', async ({ browser }) => {
  expect.soft(ids.vendorA, 'vendor A id for the injection checks').toBeTruthy();
  const vA = await signedInPage(browser, VENDOR_A_EMAIL);
  for (const q of ['x%,status.neq.null', 'a),or(id.neq.00000000-0000-0000-0000-000000000000', `a'"\\`]) {
    const r = await apiStatus(vA, `/api/vendors/${ids.vendorA}/products?q=${encodeURIComponent(q)}`);
    record(r.status === 200, { area: 'injection', severity: 'medium', check: `vendor product search with ${JSON.stringify(q)}`, detail: `status ${r.status}` });
  }
  await vA.context().close();

  const c1 = await signedInPage(browser, ACCOUNTS.customer1);
  for (const q of ["' OR 1=1 --", 'x%,status.neq.null', '"><script>']) {
    const r = await apiStatus(c1, `/api/search?q=${encodeURIComponent(q)}`);
    record(r.status < 500, { area: 'injection', severity: 'medium', check: `public search with ${JSON.stringify(q)}`, detail: `status ${r.status}` });
  }
  for (const path of ['/api/checkout/prepare', '/api/chatbot/ask', '/api/support/tickets']) {
    const r = await c1.evaluate(async (path) => {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"broken": ' });
      return { status: res.status, text: (await res.text()).slice(0, 600) };
    }, path);
    const leaks = /node_modules|at [\w.<>]+ \(|\.tsx?:\d+|stack/i.test(r.text);
    record(r.status < 500 && !leaks, { area: 'errors', severity: 'low', check: `malformed JSON to ${path}`, detail: `status ${r.status}${leaks ? ' with stack/file details' : ''}` });
  }
  const debug = await apiStatus(c1, '/api/debug/me');
  record(debug.status === 404, { area: 'errors', severity: 'low', check: '/api/debug/me disabled in this build', detail: `status ${debug.status}` });
  await c1.context().close();
  expect.soft(findings.filter((f) => f.severity === 'critical' && f.area !== 'credentials'), 'critical access-control findings').toEqual([]);
});
