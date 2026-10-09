import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ACCOUNTS, DEMO_PASSWORD } from './helpers/demo';
import { auditTheme, type ThemeAudit } from './helpers/theme-audit';
import { POSTCARD } from './helpers/shop';

// Dark-mode consistency across the app. Part 1 drives the real Appearance control the way a
// user does. Part 2 opens every page in dark mode and measures what actually rendered:
// large light surfaces and low-contrast text that did not follow the theme.
// Findings are saved to $E2E_SHOTS_DIR/theme-findings.json; screenshots go to $E2E_SHOTS_DIR/theme/.
// Not serial: an audit that finds problems fails its test, and the next role must still run.
test.describe.configure({ timeout: 180_000 });
// Clicks have no time limit by default; a wrong locator must fail in seconds, not hang the run.
test.use({ actionTimeout: 20_000, navigationTimeout: 90_000 });

const OUT = process.env.E2E_SHOTS_DIR ?? 'e2e-shots';
const PROPS = { eventSlug: 'heritage-walk-kl-current-offers', stallVendorId: '1aa86fbf-d6af-9dfa-08f0-8ab112bcea3f', campaignId: '51cc729b-1182-4200-856e-0bce82590f44' };
const EVENT_ORDER = 'c68f2df1-26fe-4c24-a573-1b015fb53732'; // paid event reservation (QR pickup pass) of customer@demo.local

const ROLES: Record<string, { email: string | null; pages: string[] }> = {
  public: {
    email: null,
    pages: ['/login', '/help', '/legal/about', '/legal/data', '/legal/privacy', '/legal/terms', '/guest/explore', '/reset-password', '/vendor-invite', '/account-suspended', '/account-restore', '/staff'],
  },
  customer: {
    email: ACCOUNTS.customer2,
    pages: [
      '/customer', '/customer/explore', '/customer/for-you', '/customer/search', '/customer/map', '/customer/calendar', '/customer/events', '/customer/partners', '/customer/recommendations',
      '/customer/cart', '/customer/checkout', '/customer/orders', '/customer/wallet', '/customer/vouchers', '/customer/saved', '/customer/wishlist', '/customer/trip',
      '/customer/profile', '/customer/profile/register-vendor', '/customer/preferences', '/customer/notifications', '/customer/support', '/customer/affiliate',
      '/customer/kyc', '/customer/verification', '/customer/phone', '/customer/activity',
      `/customer/activity/${POSTCARD.productId}`, `/customer/events/${PROPS.eventSlug}`, `/customer/events/${PROPS.eventSlug}/${PROPS.stallVendorId}`,
      `/customer/vendor/${POSTCARD.vendorId}`, '/customer/orders/55a5d315-ea88-46cc-ab98-fbcd8084b37c',
    ],
  },
  'customer-qr': { email: ACCOUNTS.customer, pages: [`/customer/orders/${EVENT_ORDER}`] },
  vendor: {
    email: POSTCARD.vendorOwner,
    pages: [
      '/vendor/dashboard', '/vendor/analytics', '/vendor/announcements', '/vendor/bookings', '/vendor/inbox', '/vendor/listings', '/vendor/orders', '/vendor/outlets',
      '/vendor/products', '/vendor/profile', '/vendor/redemptions', '/vendor/vouchers', '/vendor/wallet', '/vendor/scanner', '/vendor/event-promotions', '/vendor/events',
    ],
  },
  'vendor-event': { email: ACCOUNTS.eventVendorB, pages: ['/vendor/events', `/vendor/events/${PROPS.campaignId}`, '/vendor/event-orders', '/vendor/scanner'] },
  admin: {
    email: ACCOUNTS.admin,
    pages: [
      '/admin/dashboard', '/admin/vendors', '/admin/vendors/platform-fees', '/admin/catalogue', '/admin/kyc', '/admin/recommendations', '/admin/recommendations/rewards', '/admin/refunds',
      '/admin/withdrawals', '/admin/orders', '/admin/wallet/settings', '/admin/wallet/approvers', '/admin/reports/payouts', '/admin/reports/reconciliation', '/admin/support',
      '/admin/chat-reports', '/admin/affiliate', '/admin/chatbot', '/admin/users', '/admin/access-control', '/admin/ai-assistant', '/admin/staff-conduct', '/admin/moderation-words',
      '/admin/sponsored-placements', '/admin/promotion-campaigns', '/admin/event-registrations', '/admin/event-promotions', '/admin/announcements', '/admin/rewards',
    ],
  },
};

async function newContext(browser: Browser, { dark, email }: { dark: boolean; email: string | null }) {
  // The OS stays "light" so only the saved choice (or the control) can switch the theme.
  const context = await browser.newContext({ colorScheme: 'light' });
  if (dark) await context.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch { /* storage blocked */ } });
  const page = await context.newPage();
  if (email) {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
    await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120_000 });
  }
  return { context, page };
}

const html = (page: Page) => page.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), stored: localStorage.getItem('theme') }));

async function pickTheme(page: Page, label: 'Light' | 'Dark' | 'System') {
  const menu = page.getByRole('menu', { name: 'Appearance settings' });
  // The menu stays open after a choice, so only open it when it is closed.
  if (!(await menu.isVisible())) await page.getByRole('button', { name: 'Appearance settings' }).first().click();
  await menu.getByRole('button', { name: label, exact: true }).click();
}

test.describe('the Appearance control', () => {
  const AREAS: Array<{ name: string; email: string; start: string; next: string }> = [
    { name: 'customer', email: ACCOUNTS.customer2, start: '/customer', next: '/customer/wallet' },
    { name: 'vendor', email: POSTCARD.vendorOwner, start: '/vendor/dashboard', next: '/vendor/wallet' },
    { name: 'admin', email: ACCOUNTS.admin, start: '/admin/dashboard', next: '/admin/vendors' },
  ];

  for (const area of AREAS) {
    test(`${area.name}: Dark is applied, kept across pages and a reload, and Light and System work`, async ({ browser }) => {
      const { context, page } = await newContext(browser, { dark: false, email: area.email });
      await page.goto(area.start, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: 'Appearance settings' }).first()).toBeVisible({ timeout: 120_000 });
      expect((await html(page)).dark, 'starts light when the OS is light').toBe(false);

      await pickTheme(page, 'Dark');
      await expect.poll(async () => (await html(page)).dark).toBe(true);
      const dark = await auditTheme(page);
      expect(dark.bodyLuminance, 'page background turns dark').toBeLessThan(0.2);

      await page.goto(area.next, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
      expect(await html(page), 'dark persists on another page').toEqual({ dark: true, stored: 'dark' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      expect((await html(page)).dark, 'dark persists after a reload (no flash back to light)').toBe(true);

      await pickTheme(page, 'Light');
      await expect.poll(async () => (await html(page)).dark).toBe(false);
      await pickTheme(page, 'System');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect.poll(async () => (await html(page)).dark, { message: 'System follows an OS in dark mode' }).toBe(true);
      await page.emulateMedia({ colorScheme: 'light' });
      await expect.poll(async () => (await html(page)).dark, { message: 'System follows an OS back to light' }).toBe(false);
      await context.close();
    });
  }

  test('the choice carries over from one area to another (customer to vendor to admin)', async ({ browser }) => {
    // One browser profile, three roles in turn, is not possible with one login; check the stored choice instead:
    // a dark choice saved by the control is what every layout reads on load.
    const { context, page } = await newContext(browser, { dark: false, email: ACCOUNTS.customer2 });
    await page.goto('/customer', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Appearance settings' }).first()).toBeVisible({ timeout: 120_000 });
    await pickTheme(page, 'Dark');
    expect((await html(page)).stored).toBe('dark');
    for (const path of ['/login', '/help', '/legal/terms', '/guest/explore']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect((await html(page)).dark, `${path} also follows the saved choice`).toBe(true);
    }
    await context.close();
  });
});

const findings: Record<string, ThemeAudit[]> = {};

for (const [role, config] of Object.entries(ROLES)) {
  test(`dark mode audit: ${role} pages`, async ({ browser }) => {
    test.setTimeout(1_800_000);
    const { context, page } = await newContext(browser, { dark: true, email: config.email });
    findings[role] = [];
    for (const path of config.pages) {
      await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      // A page that redirects while loading destroys the page context mid-check; settle and retry once.
      const audit = await auditTheme(page).catch(async () => { await page.waitForLoadState('load').catch(() => undefined); await page.waitForTimeout(2000); return auditTheme(page); });
      audit.url = `${path}  ->  ${new URL(page.url()).pathname}`;
      findings[role].push(audit);
      const bad = audit.lightSurfaces.length + audit.lowContrast.filter((c) => c.ratio < 2).length;
      if (bad > 0) {
        mkdirSync(`${OUT}/theme`, { recursive: true });
        await page.screenshot({ path: `${OUT}/theme/${role}${path.replaceAll('/', '_')}.png`, fullPage: true }).catch(() => undefined);
      }
      expect.soft(audit.htmlIsDark, `${path}: <html> has the dark class`).toBe(true);
      expect.soft(audit.bodyLuminance, `${path}: page background is dark`).toBeLessThan(0.2);
      expect.soft(audit.lightSurfaces.length, `${path}: light surfaces left in dark mode`).toBe(0);
      expect.soft(audit.lowContrast.filter((c) => c.ratio < 2).length, `${path}: text with contrast below 2:1`).toBe(0);
    }
    // One file per role: a failed test restarts the worker, so shared state would be lost.
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/theme-findings-${role}.json`, JSON.stringify(findings[role], null, 2));
    await context.close();
  });
}
