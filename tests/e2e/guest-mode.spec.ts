import { expect, test } from "@playwright/test";

test("Guest Mode enters Home and Trip navigation requires sign-in", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /guest mode/i }).click();
  await expect(page).toHaveURL(/\/customer$/, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Home", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore", exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Trip", exact: true }).first().click();
  const tripDialog = page.getByRole("dialog");
  await expect(tripDialog).toBeVisible();
  await tripDialog.getByRole("button", { name: "Continue browsing", exact: true }).click();
  await expect(tripDialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/customer$/);
});

test("Guest cart navigation opens the existing cart without a sign-in gate", async ({ page }) => {
  await page.route("**/api/guest/cart", (route) => route.fulfill({ json: { data: { items: [] }, error: null } }));
  await page.goto("/customer/explore");
  await page.getByRole("link", { name: "Shopping cart", exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/cart$/);
  await expect(page.getByRole("button", { name: "Sign in / Register", exact: true })).toHaveCount(0);
});

test("Guest Mode can open an approved vendor", async ({ page }) => {
  await page.goto("/guest/explore");
  await expect(page).toHaveURL(/\/customer\/explore$/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Partners", exact: true }).first().click();
  await expect(page).toHaveURL(/\/customer\/partners$/);
  const vendor = page.locator('a[href^="/customer/vendor/"]').first();
  await expect(vendor).toBeVisible();
  await vendor.click();
  await expect(page).toHaveURL(/\/customer\/vendor\//);
});

test("Guest home save and notifications ask without private requests", async ({ page }) => {
  const mutations: string[] = [];
  const privateReads: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PATCH", "DELETE"].includes(request.method()) && /\/api\/(wishlist|notifications|saved-destinations)/.test(request.url())) mutations.push(request.url());
    if (request.method() === "GET" && /\/api\/(wishlist|saved-destinations)(\?|$)/.test(request.url())) privateReads.push(request.url());
  });

  await page.goto("/customer");
  const save = page.getByRole("button", { name: "Save destination", exact: true });
  await expect(save).toBeVisible();
  await save.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue browsing", exact: true }).click();
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/customer$/);
  expect(mutations).toEqual([]);
  expect(privateReads).toEqual([]);
});
