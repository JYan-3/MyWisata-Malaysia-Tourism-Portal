import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, api, contextFor, shot } from './helpers/demo';

// Admin event creation rules. Everything created here is a draft named "E2E Event ..."
// and nothing here may ever be published to customers.
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const STAMP = Date.now().toString(36);
const TITLE = `E2E Event ${STAMP}`;
const SLUG = `e2e-event-${STAMP}`;
const valid = {
  title: TITLE, slug: SLUG, summary: 'A throwaway draft created by the E2E suite.', description: 'This draft is created by an automated test and never published.',
  startsAt: '2026-11-01T02:00:00.000Z', endsAt: '2026-11-08T14:00:00.000Z', posterUrl: null, operatingHours: '10:00 AM - 10:00 PM',
};

type Campaign = { id: string; title: string; status: string; updated_at: string };
async function listCampaigns(page: Page) {
  const response = await api(page, 'GET', '/api/admin/promotion-campaigns');
  expect(response.status).toBe(200);
  const data = (response.json as { data: Campaign[] | { campaigns: Campaign[] } }).data;
  return Array.isArray(data) ? data : data.campaigns;
}

test('creation rules: bad slug, backwards dates, short text and non-admins are refused', async ({ browser }) => {
  const admin = await contextFor(browser, ACCOUNTS.admin);
  const { page } = admin;
  await page.goto('/admin/promotion-campaigns', { waitUntil: 'domcontentloaded' });
  const create = (over: Record<string, unknown>) => api(page, 'POST', '/api/admin/promotion-campaigns', { ...valid, ...over });

  for (const [name, over] of Object.entries({
    'uppercase slug': { slug: 'Not A Slug' },
    'end before start': { startsAt: '2026-11-08T14:00:00.000Z', endsAt: '2026-11-01T02:00:00.000Z' },
    'too-short title': { title: 'ab' },
    'too-short summary': { summary: 'short' },
    'unknown field': { surprise: true },
  })) {
    const response = await create(over);
    expect(response.status, `${name} must be refused`).toBeGreaterThanOrEqual(400);
    expect(response.status, `${name} must be a validation error, not a crash`).toBeLessThan(500);
  }
  // None of those created anything.
  expect((await listCampaigns(page)).filter((c) => c.title.startsWith('E2E Event'))).toHaveLength(0);
  await admin.context.close();

  // A customer cannot create events.
  const customer = await contextFor(browser, ACCOUNTS.customer);
  const forbidden = await api(customer.page, 'POST', '/api/admin/promotion-campaigns', valid);
  expect([401, 403]).toContain(forbidden.status);
  await customer.context.close();
});

test('an incomplete event cannot be published from the form', async ({ browser }) => {
  const admin = await contextFor(browser, ACCOUNTS.admin);
  const { page } = admin;
  await page.goto('/admin/promotion-campaigns', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Create an event').first()).toBeVisible({ timeout: 90_000 });

  await page.getByLabel('Event title').fill(TITLE);
  await page.getByLabel('Page address').fill(SLUG);
  await page.getByLabel('Short description').fill(valid.summary);
  await page.getByLabel('Full description').fill(valid.description);
  await page.getByLabel('Opens each day').fill('10:00');
  await page.getByLabel('Closes each day').fill('22:00');
  await shot(page, 'ev11_create_form_filled');

  // No poster and no location: the draft may be saved, but publishing must be refused.
  await page.getByRole('button', { name: 'Publish event' }).click();
  await page.waitForTimeout(8000);
  await shot(page, 'ev12_publish_refused');

  const mine = (await listCampaigns(page)).filter((c) => c.title === TITLE);
  expect(mine.length, 'the draft exists at most once').toBeLessThanOrEqual(1);
  for (const campaign of mine) expect(['draft', 'rejected']).toContain(campaign.status);

  // It must not be visible to customers.
  const publicList = await api(page, 'POST', '/rest/v1/rpc/get_public_promotion_campaigns', { p_slug: SLUG });
  expect(JSON.stringify(publicList.json ?? '')).not.toContain(TITLE);
  await admin.context.close();
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(180_000);
  // Safety net: none of these test events may ever end up published to customers.
  const admin = await contextFor(browser, ACCOUNTS.admin);
  await admin.page.goto('/admin/promotion-campaigns', { waitUntil: 'domcontentloaded' });
  const published = (await listCampaigns(admin.page)).filter((c) => c.title.startsWith('E2E Event') && ['approved', 'pending_approval', 'paused'].includes(c.status));
  expect(published).toHaveLength(0);
  await admin.context.close();
});
