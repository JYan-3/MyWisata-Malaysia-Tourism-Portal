import { expect, test } from '@playwright/test';
import { localEnv } from './helpers/demo';

test.use({ trace: 'off' });
import { ACCOUNTS, signIn } from './helpers/demo';

test('local admin session fixture signs in a seeded customer without opening password login', async ({ page }) => {
  expect(localEnv('E2E_AUTH_MODE'), 'run this acceptance check only with the local admin-session fixture enabled').toBe('admin-session');
  await signIn(page, ACCOUNTS.customer);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page).not.toHaveURL(/\/admin\/security/);
});
