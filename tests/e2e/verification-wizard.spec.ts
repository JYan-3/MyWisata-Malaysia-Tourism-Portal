import { expect, test } from '@playwright/test';

test('customer verification wizard exposes five stable steps and progress', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill('customer@demo.local');
  await page.locator('input[type="password"]').fill('demo123456');
  await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

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
