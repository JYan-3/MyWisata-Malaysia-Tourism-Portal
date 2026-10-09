import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, api, contextFor, shot } from './helpers/demo';
import { POSTCARD, buyProduct, settlementFor } from './helpers/shop';

// Vendor platform fee tiers on the live demo data. Tier settings are changed and then
// restored to the seeded defaults (3 tiers at 15%, thresholds RM0 / RM10,000 / RM50,000,
// no event fee), also from afterAll if a step fails half way.
test.describe.configure({ mode: 'serial', timeout: 420_000 });

const ORIGINAL_TIERS = [
  { rank: 1, name: 'Bronze', feeType: 'percent', percentRate: 0.15, fixedPerItemSen: null, minSalesSen: 0 },
  { rank: 2, name: 'Silver', feeType: 'percent', percentRate: 0.15, fixedPerItemSen: null, minSalesSen: 1_000_000 },
  { rank: 3, name: 'Gold', feeType: 'percent', percentRate: 0.15, fixedPerItemSen: null, minSalesSen: 5_000_000 },
];
const QUANTITY = 3; // 3 postcards x RM5.00 = RM15.00

type FeeSettings = { tiers: Array<{ rank: number; name: string; feeType: string; percentRate: number | null; fixedPerItemSen: number | null; minSalesSen: number }>; eventDefaultPerItemSen: number | null; vendorCounts: Record<string, number>; canEdit: boolean };
async function readSettings(page: Page) {
  const response = await api(page, 'GET', '/api/admin/vendor-fee-tiers');
  expect(response.status).toBe(200);
  return (response.json as { data: FeeSettings }).data;
}

async function openFeesPage(page: Page) {
  await page.goto('/admin/vendors/platform-fees', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('group', { name: /Tier 2/ })).toBeVisible({ timeout: 120_000 });
}

async function saveFeesPage(page: Page, reason: string) {
  await page.getByLabel('Reason for this change').fill(reason);
  const saved = page.waitForResponse((r) => r.url().includes('/api/admin/vendor-fee-tiers') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Save settings' }).last().click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
}

test('baseline: the default Bronze tier charges 15% of the item price', async ({ browser }) => {
  const settings = await (async () => { const a = await contextFor(browser, ACCOUNTS.admin); const s = await readSettings(a.page); await a.context.close(); return s; })();
  expect(settings.tiers).toMatchObject(ORIGINAL_TIERS);

  const customer = await contextFor(browser, ACCOUNTS.customer2);
  const orderId = await buyProduct(customer.page, POSTCARD.productId, QUANTITY, 'tier1_baseline');
  await customer.context.close();

  const admin = await contextFor(browser, ACCOUNTS.admin);
  const row = await settlementFor(admin.page, orderId, POSTCARD.vendorId);
  // RM15.00 x 15% = RM2.25.
  expect(row).toMatchObject({ grossSen: 1500, platformFeeSen: 225, vendorNetSen: 1275, feeType: 'percent', feeSource: 'tier', itemCount: QUANTITY });
  expect(row.platformRate).toBeCloseTo(0.15, 4);
  await admin.context.close();
});

test('only the right people can read or change the fees, and bad settings are refused', async ({ browser }) => {
  // Customers and wallet approvers have no vendor-management permission.
  for (const email of [ACCOUNTS.customer, 'approver@demo.local']) {
    const person = await contextFor(browser, email);
    const read = await api(person.page, 'GET', '/api/admin/vendor-fee-tiers');
    expect([401, 403], `${email} cannot read the fees`).toContain(read.status);
    const write = await api(person.page, 'PUT', '/api/admin/vendor-fee-tiers', { tiers: ORIGINAL_TIERS, eventDefaultPerItemSen: null, campaignFees: [], reason: 'not allowed to do this' });
    expect([401, 403], `${email} cannot change the fees`).toContain(write.status);
    await person.context.close();
  }

  const admin = await contextFor(browser, ACCOUNTS.admin);
  const { page } = admin;
  await page.goto('/admin/vendors/platform-fees', { waitUntil: 'domcontentloaded' });
  const put = (over: Record<string, unknown>) => api(page, 'PUT', '/api/admin/vendor-fee-tiers', { tiers: ORIGINAL_TIERS, eventDefaultPerItemSen: null, campaignFees: [], reason: 'E2E validation probe', ...over });
  const withTier = (rank: number, over: Record<string, unknown>) => ORIGINAL_TIERS.map((tier) => (tier.rank === rank ? { ...tier, ...over } : tier));

  const cases: Record<string, Record<string, unknown>> = {
    'thresholds that do not rise': { tiers: withTier(3, { minSalesSen: 1_000_000 }) },
    'first tier not starting at RM0': { tiers: withTier(1, { minSalesSen: 100 }) },
    'only two tiers': { tiers: ORIGINAL_TIERS.slice(0, 2) },
    'percentage of 100%': { tiers: withTier(1, { percentRate: 1 }) },
    'negative percentage': { tiers: withTier(1, { percentRate: -0.1 }) },
    'fixed fee above RM1,000 per item': { tiers: withTier(1, { feeType: 'fixed', percentRate: null, fixedPerItemSen: 100_001 }) },
    'fixed tier with no amount': { tiers: withTier(1, { feeType: 'fixed', percentRate: null, fixedPerItemSen: null }) },
    'blank tier name': { tiers: withTier(1, { name: '   ' }) },
    'reason that is too short': { reason: 'short' },
    'negative event fee': { eventDefaultPerItemSen: -5 },
    'unknown event id': { campaignFees: [{ id: crypto.randomUUID(), perItemSen: 10 }] },
  };
  for (const [name, over] of Object.entries(cases)) {
    const response = await put(over);
    expect(response.status, `${name} must be refused`).toBeGreaterThanOrEqual(400);
    expect(response.status, `${name} must not crash the server`).toBeLessThan(600);
  }
  // Nothing above may have changed the fees.
  expect((await readSettings(page)).tiers).toMatchObject(ORIGINAL_TIERS);

  // The same rules show up as readable messages in the form, and nothing is sent.
  await openFeesPage(page);
  let sent = 0;
  page.on('request', (r) => { if (r.url().includes('/api/admin/vendor-fee-tiers') && r.method() === 'PUT') sent++; });
  const tier = (n: number) => page.getByRole('group', { name: new RegExp(`Tier ${n}`) });
  const save = () => page.getByRole('button', { name: 'Save settings' }).first().click();
  const alert = () => page.locator('p[role="alert"]');

  await page.getByLabel('Reason for this change').fill('short');
  await save();
  await expect(alert()).toContainText('at least 10 characters');

  await page.getByLabel('Reason for this change').fill('E2E: checking the form messages');
  await tier(1).getByLabel('Fee (%)').fill('100');
  await save();
  await expect(alert()).toContainText('below 100%');
  await tier(1).getByLabel('Fee (%)').fill('15');

  await tier(3).getByLabel('Sales needed (last 90 days)').fill('5000');
  await save();
  await expect(alert()).toContainText('needs more sales');
  await tier(3).getByLabel('Sales needed (last 90 days)').fill('50000');

  await tier(2).getByLabel('Fee (%)').fill('');
  await save();
  await expect(alert()).toContainText('Fill in every tier');
  await shot(page, 'tier2_form_validation');
  expect(sent, 'invalid forms never reach the server').toBe(0);
  await admin.context.close();
});

test('admin turns tier 2 into a fixed RM1.00 per item and pins the vendor to it', async ({ browser }) => {
  const admin = await contextFor(browser, ACCOUNTS.admin);
  const { page } = admin;
  await openFeesPage(page);

  const tier2 = page.getByRole('group', { name: /Tier 2/ });
  await tier2.getByLabel('Tier name').fill('E2E Silver');
  await tier2.getByLabel('Fee type').selectOption({ label: 'Fixed amount per item' });
  await tier2.getByLabel('Fee per item (RM)').fill('1');
  // The preview tells the admin what a sale would cost: 3 items at RM20.00.
  await expect(tier2).toContainText('RM3.00');
  await saveFeesPage(page, 'E2E: make tier 2 a fixed per-item fee');
  await shot(page, 'tier3_tier2_fixed_saved');
  expect((await readSettings(page)).tiers[1]).toMatchObject({ name: 'E2E Silver', feeType: 'fixed', fixedPerItemSen: 100, percentRate: null });

  // Pin the vendor to tier 2 from the vendor review drawer.
  await page.goto('/admin/vendors', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/search/i).first().fill('Gerakbudaya');
  const row = page.locator('tbody tr').filter({ hasText: POSTCARD.vendorId.slice(0, 8) });
  await expect(row).toBeVisible({ timeout: 120_000 });
  await row.getByRole('button').first().click();
  const pin = page.getByLabel('Tier assignment');
  await expect(pin).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('dialog')).toContainText('Platform fee');
  const pinned = page.waitForResponse((r) => r.url().includes(`/api/admin/vendors/${POSTCARD.vendorId}/fee-tier`) && r.request().method() === 'PATCH');
  await pin.selectOption({ label: 'Always E2E Silver' });
  expect((await pinned).status()).toBe(200);
  await shot(page, 'tier4_vendor_pinned');
  await admin.context.close();
});

test('a pinned vendor is charged the tier fee per item, not 15%', async ({ browser }) => {
  const customer = await contextFor(browser, ACCOUNTS.customer2);
  const orderId = await buyProduct(customer.page, POSTCARD.productId, QUANTITY, 'tier5_pinned');
  await customer.context.close();

  const admin = await contextFor(browser, ACCOUNTS.admin);
  const row = await settlementFor(admin.page, orderId, POSTCARD.vendorId);
  // 3 items x RM1.00 = RM3.00 (15% would have been RM2.25).
  expect(row).toMatchObject({ grossSen: 1500, platformFeeSen: 300, vendorNetSen: 1200, feeType: 'fixed', feeSource: 'tier', feePerItemSen: 100, itemCount: QUANTITY });
  await admin.context.close();
});

test('the vendor sees their tier, the fee and how each order was charged', async ({ browser }) => {
  const vendor = await contextFor(browser, POSTCARD.vendorOwner);
  const { page } = vendor;
  await page.goto('/vendor/wallet', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Your platform fee')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('E2E Silver · RM1.00 / item')).toBeVisible();
  await expect(page.getByText('Your tier is set by the platform team.')).toBeVisible();
  // Newest order first: the pinned one charged RM1.00 per item for 3 items; the baseline one 15%.
  await expect(page.getByText('RM1.00 / item × 3').first()).toBeVisible();
  await expect(page.getByText('15%').first()).toBeVisible();
  await shot(page, 'tier6_vendor_view_pinned');

  // Read-only: the vendor has no way to change their own fee.
  const attempt = await api(page, 'PATCH', `/api/admin/vendors/${POSTCARD.vendorId}/fee-tier`, { pinnedRank: 1 });
  expect([401, 403]).toContain(attempt.status);
  const attemptTiers = await api(page, 'PUT', '/api/admin/vendor-fee-tiers', { tiers: ORIGINAL_TIERS, eventDefaultPerItemSen: null, campaignFees: [], reason: 'vendor trying to edit fees' });
  expect([401, 403]).toContain(attemptTiers.status);
  await vendor.context.close();
});

/** Puts the seeded defaults back and unpins the test vendor. Safe to run any number of times. */
async function restoreDefaults(page: Page) {
  await api(page, 'PATCH', `/api/admin/vendors/${POSTCARD.vendorId}/fee-tier`, { pinnedRank: null });
  const restored = await api(page, 'PUT', '/api/admin/vendor-fee-tiers', { tiers: ORIGINAL_TIERS, eventDefaultPerItemSen: null, campaignFees: [], reason: 'E2E: restore the seeded fee defaults' });
  expect(restored.status, JSON.stringify(restored.json)).toBe(200);
}

test('restoring the defaults puts the vendor back on Bronze at 15%', async ({ browser }) => {
  const admin = await contextFor(browser, ACCOUNTS.admin);
  await restoreDefaults(admin.page);
  expect((await readSettings(admin.page)).tiers).toMatchObject(ORIGINAL_TIERS);
  await admin.context.close();

  const vendor = await contextFor(browser, POSTCARD.vendorOwner);
  await vendor.page.goto('/vendor/wallet', { waitUntil: 'domcontentloaded' });
  await expect(vendor.page.getByText('Bronze · 15%')).toBeVisible({ timeout: 120_000 });
  await expect(vendor.page.getByText('Your tier is set by the platform team.')).toHaveCount(0);
  await shot(vendor.page, 'tier7_vendor_back_on_bronze');
  await vendor.context.close();
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await contextFor(browser, ACCOUNTS.admin);
  await restoreDefaults(admin.page);
  await admin.context.close();
});
