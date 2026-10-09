import { expect, test, type Browser, type Page } from '@playwright/test';
import { ACCOUNTS, DEMO_PASSWORD, api, contextFor, runPaidOrderJob, shot } from './helpers/demo';
import { POSTCARD, buyProduct, settlementFor } from './helpers/shop';

// Affiliate user side on the demo data. customer1 owns a link and is a fully verified
// affiliate; customer2 is the friend who clicks it and buys. Payments use the demo
// simulator. Run one spec at a time against this database (workers: 1).
test.describe.configure({ mode: 'serial', timeout: 420_000 });

const AFFILIATE = ACCOUNTS.customer1;
const BUYER = ACCOUNTS.customer2;
const LINK_CODE = 'AF-87J3J8';
const SHARE_PATH = `/r/${LINK_CODE}/gerakbudaya-george-town-postcards`;
const QUANTITY = 3; // 3 postcards x RM5.00 = RM15.00

type Stats = {
  affiliateCode: string | null;
  affiliateUrl: string | null;
  totals: { clicks: number; referrals: number; pendingEarnings: number; availableToWithdraw: number; totalEarnings: number };
  commissions: Array<{ id: string; orderAmount: number | null; rate: number; amount: number; status: string }>;
  tier: { tierName: string; rate: number; referralCount: number };
};

async function readStats(page: Page): Promise<Stats> {
  const response = await api(page, 'GET', '/api/affiliate/stats');
  expect(response.status, JSON.stringify(response.json)).toBe(200);
  return (response.json as { data: Stats }).data;
}

/** Signs in a fresh browser context as `email`, runs `fn` with its page, and always closes it. */
async function as<T>(browser: Browser, email: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const person = await contextFor(browser, email);
  try { return await fn(person.page); } finally { await person.context.close(); }
}

const state: { before?: Stats } = {};

test('the affiliate dashboard shows the owner their link, tier and live numbers', async ({ browser }) => {
  await as(browser, AFFILIATE, async (page) => {
    await page.goto('/customer/affiliate', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Earn & Share').first()).toBeVisible({ timeout: 120_000 });
    const stats = await readStats(page);
    state.before = stats;
    expect(stats.affiliateCode).toBe(LINK_CODE);
    expect(stats.affiliateUrl).toContain(`/r/${LINK_CODE}`);
    expect(stats.tier.rate).toBeGreaterThan(0);
    // The page shows the same tier the API reports ("Standard · 3%").
    await expect(page.getByText(new RegExp(`${stats.tier.tierName}\\s*·\\s*${Math.round(stats.tier.rate * 100)}%`, 'i')).first()).toBeVisible();
    await shot(page, 'aff1_dashboard');
  });
});

test('clicking your own link is not counted as a click', async ({ browser }) => {
  await as(browser, AFFILIATE, async (page) => {
    const before = (await readStats(page)).totals.clicks;
    const response = await page.goto(SHARE_PATH, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    // The owner still lands on the product, but no click is recorded and no referral cookie is set.
    await page.waitForURL(/\/customer\/activity\//, { timeout: 120_000 });
    expect((await page.context().cookies()).some((c) => c.name === 'mw_ref')).toBe(false);
    await page.waitForTimeout(2000);
    expect((await readStats(page)).totals.clicks).toBe(before);
  });
});

test("a friend's click on the link is counted and sets the referral cookie", async ({ browser }) => {
  const owner = await contextFor(browser, AFFILIATE);
  const before = (await readStats(owner.page)).totals.clicks;
  await as(browser, BUYER, async (page) => {
    const response = await page.goto(SHARE_PATH, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    await page.waitForURL(/\/customer\/activity\//, { timeout: 120_000 });
    expect((await page.context().cookies()).some((c) => c.name === 'mw_ref')).toBe(true);
  });
  await expect.poll(async () => (await readStats(owner.page)).totals.clicks, { timeout: 30_000 }).toBe(before + 1);
  await owner.context.close();
});

const ORIGINAL_TIERS = [
  { rank: 1, name: 'Bronze', feeType: 'percent', percentRate: 0.15, fixedPerItemSen: null, minSalesSen: 0 },
  { rank: 2, name: 'Silver', feeType: 'percent', percentRate: 0.15, fixedPerItemSen: null, minSalesSen: 1_000_000 },
  { rank: 3, name: 'Gold', feeType: 'percent', percentRate: 0.15, fixedPerItemSen: null, minSalesSen: 5_000_000 },
];
const putTiers = (page: Page, tiers: unknown[], reason: string) => api(page, 'PUT', '/api/admin/vendor-fee-tiers', { tiers, eventDefaultPerItemSen: null, campaignFees: [], reason });

/** A buyer opens the affiliate's link (cookie + click), then buys 3 postcards with their wallet. */
async function referredPurchase(browser: Browser) {
  return as(browser, BUYER, async (page) => {
    await page.goto(SHARE_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/customer\/activity\//, { timeout: 120_000 });
    return buyProduct(page, POSTCARD.productId, QUANTITY, 'aff3_referred_wallet', 'wallet');
  });
}

test('a referred purchase pays the owner a pending commission at their tier rate', async ({ browser }) => {
  const owner = await contextFor(browser, AFFILIATE);
  const before = await readStats(owner.page);
  const orderId = await referredPurchase(browser);

  let commission: Stats['commissions'][number] | undefined;
  await expect.poll(async () => {
    const stats = await readStats(owner.page);
    commission = stats.commissions.find((c) => !before.commissions.some((old) => old.id === c.id));
    return commission !== undefined;
  }, { timeout: 60_000, message: 'a new commission appears for the owner' }).toBe(true);

  // RM15.00 order x the owner's tier rate (3% = RM0.45), held until it clears.
  expect(commission).toMatchObject({ orderAmount: 15, rate: before.tier.rate, status: 'pending' });
  expect(commission?.amount).toBeCloseTo(15 * before.tier.rate, 2);
  const after = await readStats(owner.page);
  expect(after.totals.pendingEarnings).toBeCloseTo(before.totals.pendingEarnings + (commission?.amount ?? 0), 2);
  await owner.page.goto('/customer/affiliate', { waitUntil: 'domcontentloaded' });
  await expect(owner.page.getByText('Earn & Share').first()).toBeVisible({ timeout: 120_000 });
  await shot(owner.page, 'aff3_owner_commission');
  await owner.context.close();

  // The platform pays this from its fee: 15% of RM15.00 (RM2.25) covers it, so the vendor pays the normal fee.
  const admin = await contextFor(browser, ACCOUNTS.admin);
  const row = await settlementFor(admin.page, orderId, POSTCARD.vendorId);
  expect(row).toMatchObject({ platformFeeSen: 225, payoutFloorApplied: false });
  await admin.context.close();
});

test('when the fee is smaller than the commission, the fee is raised to cover it', async ({ browser }) => {
  const admin = await contextFor(browser, ACCOUNTS.admin);
  try {
    // Tier 1 at RM0.10 per item: 3 items = RM0.30, which is less than the RM0.45 commission.
    const lowFee = ORIGINAL_TIERS.map((tier) => (tier.rank === 1 ? { ...tier, feeType: 'fixed', percentRate: null, fixedPerItemSen: 10 } : tier));
    expect((await putTiers(admin.page, lowFee, 'E2E: low fixed fee to prove the payout floor')).status).toBe(200);

    const orderId = await referredPurchase(browser);
    // The commission is created a moment after the order settles, so the fee starts at RM0.30 and is then raised.
    await expect.poll(async () => (await settlementFor(admin.page, orderId, POSTCARD.vendorId)).platformFeeSen, { timeout: 60_000, message: 'the fee is raised to cover the commission' }).toBe(45);
    const row = await settlementFor(admin.page, orderId, POSTCARD.vendorId);
    expect(row).toMatchObject({ grossSen: 1500, platformFeeSen: 45, vendorNetSen: 1455, feeType: 'fixed', feePerItemSen: 10, payoutFloorApplied: true });
  } finally {
    expect((await putTiers(admin.page, ORIGINAL_TIERS, 'E2E: restore the seeded fee defaults')).status).toBe(200);
    await admin.context.close();
  }
});

test('buying through your own link earns nothing, is only a low-severity note, and does not hurt the affiliate', async ({ browser }) => {
  const admin = await contextFor(browser, ACCOUNTS.admin);
  type Flag = { id: string; flagType: string; severity: string; orderId: string | null };
  const listFlags = async () => {
    const response = await api(admin.page, 'GET', '/api/admin/affiliate/fraud-flags');
    expect(response.status).toBe(200);
    return ((response.json as { data: { flags: Flag[] } }).data.flags ?? []);
  };
  const idsBefore = new Set((await listFlags()).map((flag) => flag.id));

  const owner = await contextFor(browser, AFFILIATE);
  // The affiliate pays RM5.00 from their own wallet, so each run uses up RM5.00 of spendable balance.
  const wallet = await api(owner.page, 'GET', '/api/wallet/summary');
  const spendableSen = (wallet.json as { data?: { topupSen: number; earningsSen: number } } | null)?.data;
  const available = (spendableSen?.topupSen ?? 0) + (spendableSen?.earningsSen ?? 0);
  if (available < 500) {
    await owner.context.close();
    await admin.context.close();
    test.skip(true, `customer1's wallet has only ${available} sen left; earlier runs spent it. Top it up to re-run this test.`);
  }
  const code = LINK_CODE;
  const ownPath = SHARE_PATH;
  const before = await readStats(owner.page);

  // Signed out, the owner's own click counts like anyone's and sets the cookie; then they sign in and buy.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(ownPath, { waitUntil: 'domcontentloaded' });
  expect((await guestContext.cookies()).some((c) => c.name === 'mw_ref')).toBe(true);
  await guest.goto('/login');
  await guest.locator('input[type="email"]').fill(AFFILIATE);
  await guest.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await guest.locator('form').getByRole('button', { name: /^sign in$/i }).click();
  await guest.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120_000 });
  const orderId = await buyProduct(guest, POSTCARD.productId, 1, 'aff4_self', 'wallet');
  await guestContext.close();

  // The note is recorded for the admin, as low severity.
  let flag: Flag | undefined;
  await expect.poll(async () => {
    flag = (await listFlags()).find((f) => !idsBefore.has(f.id) && f.orderId === orderId);
    return flag !== undefined;
  }, { timeout: 60_000, message: 'a self-referral note is recorded for the order' }).toBe(true);
  expect(flag).toMatchObject({ flagType: 'self_referral', severity: 'low' });

  // No commission, the link keeps working, and the tier is untouched.
  const after = await readStats(owner.page);
  expect(after.commissions).toHaveLength(before.commissions.length);
  expect(after.totals.pendingEarnings).toBeCloseTo(before.totals.pendingEarnings, 2);
  expect(after.affiliateCode).toBe(code);
  expect(after.tier.tierName).toBe(before.tier.tierName);
  await owner.context.close();
  await admin.context.close();
});

test('an unverified customer is asked to verify before they can earn', async ({ browser }) => {
  await as(browser, ACCOUNTS.customer, async (page) => {
    await page.goto('/customer/affiliate', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Verify your account to unlock affiliate sharing and earnings.')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('button', { name: 'Verify my account' })).toBeVisible();
    await shot(page, 'aff5_unverified');
  });
});

// Redirect payments (TNG, GrabPay, bank transfer, FPX), event reservations and guest checkouts earn
// commission through the 5-minute paid-order job (lib/orders/paid-order-effects.ts). Vercel cron does not
// run locally, so these tests run the job themselves.

/** Waits for one new commission for the affiliate and returns it. */
async function newCommission(page: Page, before: Stats) {
  let commission: Stats['commissions'][number] | undefined;
  await expect.poll(async () => {
    commission = (await readStats(page)).commissions.find((c) => !before.commissions.some((old) => old.id === c.id));
    return commission !== undefined;
  }, { timeout: 60_000, message: 'a new commission appears for the affiliate' }).toBe(true);
  return commission as Stats['commissions'][number];
}

test('a referred purchase paid by bank transfer earns a commission through the paid-order job', async ({ browser, request }) => {
  const owner = await contextFor(browser, AFFILIATE);
  const before = await readStats(owner.page);
  const orderId = await as(browser, BUYER, async (page) => {
    await page.goto(SHARE_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/customer\/activity\//, { timeout: 120_000 });
    return buyProduct(page, POSTCARD.productId, QUANTITY, 'aff6_referred_bank');
  });
  await runPaidOrderJob(request);
  const commission = await newCommission(owner.page, before);
  expect(commission).toMatchObject({ orderAmount: 15, rate: before.tier.rate, status: 'pending' });

  // Running the job again and the checkout page's fast path again changes nothing, and is not treated as fraud.
  await runPaidOrderJob(request);
  await as(browser, BUYER, async (page) => {
    await page.goto('/customer', { waitUntil: 'domcontentloaded' });
    expect((await api(page, 'POST', '/api/checkout/attribute', { orderId })).status).toBe(200);
  });
  expect((await readStats(owner.page)).commissions).toHaveLength(before.commissions.length + 1);
  const admin = await contextFor(browser, ACCOUNTS.admin);
  const flags = await api(admin.page, 'GET', '/api/admin/affiliate/fraud-flags');
  const forOrder = ((flags.json as { data: { flags: Array<{ orderId: string | null; flagType: string }> } }).data.flags ?? []).filter((f) => f.orderId === orderId);
  expect(forOrder).toEqual([]);
  await admin.context.close();
  await owner.context.close();
});

test('an event reservation through an affiliate link earns a commission', async ({ browser, request }) => {
  const owner = await contextFor(browser, AFFILIATE);
  const before = await readStats(owner.page);
  await as(browser, BUYER, async (page) => {
    // The referral cookie comes from any affiliate link; the buyer then reserves at the event.
    await page.goto(SHARE_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/customer\/activity\//, { timeout: 120_000 });
    // Tomorrow, in the Kari Kambing stall's all-day window (set up by event-flow.spec.ts).
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() + 86_400_000));
    const reserved = await api(page, 'POST', '/api/customer/event-reservations', {
      listingId: '74f41880-4572-4e5a-8a3b-6cd09900f390', pickupDate: tomorrow, slotId: 'b4e7bf0d-d079-46f3-a421-66f2403b7666', quantity: 1,
      paymentMethod: 'bank_transfer', paymentProvider: 'bank_transfer_simulator', idempotencyKey: crypto.randomUUID(),
    });
    expect(reserved.status, JSON.stringify(reserved.json)).toBe(200);
    await page.goto((reserved.json as { data: { simulatorUrl: string } }).data.simulatorUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 90_000 });
    await page.getByRole('button', { name: 'Mark funds received' }).click();
    await expect(page.getByText(/paid|received|success/i).first()).toBeVisible({ timeout: 60_000 });
  });
  await runPaidOrderJob(request);
  // RM14.00 Kari Kambing x the affiliate's rate.
  expect(await newCommission(owner.page, before)).toMatchObject({ orderAmount: 14, rate: before.tier.rate, status: 'pending' });
  await owner.context.close();
});

test('a guest who checks out without an account still earns the affiliate a commission', async ({ browser, request }) => {
  const owner = await contextFor(browser, AFFILIATE);
  const before = await readStats(owner.page);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(SHARE_PATH, { waitUntil: 'domcontentloaded' });
  expect((await guestContext.cookies()).some((c) => c.name === 'mw_ref')).toBe(true);
  // The landing page keeps navigating while it loads; call the API from a page that stays put.
  await guest.goto('/login', { waitUntil: 'load' });
  // The guest checkout endpoints, as the guest cart page calls them.
  expect((await api(guest, 'POST', '/api/guest/session')).status).toBeLessThan(300);
  const added = await api(guest, 'POST', '/api/guest/cart', { item: { activityId: POSTCARD.productId, variantId: '66ab18d0-c38d-007d-9070-32d1e60d82cf', outletId: '6dbf6ac9-13fb-003e-c063-b6e5ad70da0c', qty: 1 } });
  expect(added.status, JSON.stringify(added.json)).toBeLessThan(300);
  const prepared = await api(guest, 'POST', '/api/checkout/prepare', {
    contact: { email: `e2e-guest-${Date.now()}@example.com` },
    paymentMethod: 'bank_transfer', paymentProvider: 'bank_transfer_simulator', idempotencyKey: crypto.randomUUID(),
  });
  expect(prepared.status, JSON.stringify(prepared.json)).toBe(200);
  await guest.goto((prepared.json as { data: { simulatorUrl: string } }).data.simulatorUrl, { waitUntil: 'domcontentloaded' });
  await expect(guest.getByText('Loading…')).toHaveCount(0, { timeout: 90_000 });
  await guest.getByRole('button', { name: 'Mark funds received' }).click();
  await guest.waitForTimeout(5000);
  await shot(guest, 'aff7_guest_paid');
  await guestContext.close();

  await runPaidOrderJob(request);
  expect(await newCommission(owner.page, before)).toMatchObject({ orderAmount: 5, rate: before.tier.rate, status: 'pending' });
  await owner.context.close();
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(180_000);
  // The fee tiers must always end up at the seeded defaults, whatever failed above.
  const admin = await contextFor(browser, ACCOUNTS.admin);
  await putTiers(admin.page, ORIGINAL_TIERS, 'E2E: restore the seeded fee defaults');
  await admin.context.close();
});
