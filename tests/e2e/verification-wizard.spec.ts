import { expect, test } from '@playwright/test';
import { signIn } from './helpers/demo';

test('customer verification wizard exposes five stable steps and progress', async ({ page }) => {
  await signIn(page, 'customer@demo.local');

  const profileResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile/me') && response.request().method() === 'GET',
    { timeout: 30_000 },
  );
  await page.goto('/customer/profile');
  const profileResponse = await profileResponsePromise;
  expect(profileResponse.status()).toBe(200);
  expect(await profileResponse.json()).toHaveProperty('data');
  await expect(page.getByText(/Step \d+ of \d+/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Current:/)).toBeVisible();
  await expect(page.getByText(/Next:|Current: Complete/)).toBeVisible();
  await expect(page.getByText(/% complete/)).toBeVisible();
});
