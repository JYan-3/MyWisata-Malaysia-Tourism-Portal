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

test("Guest outlet purchase asks for sign-in without creating a cart item", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /guest mode/i }).click();
  await expect(page).toHaveURL(/\/customer$/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Partners", exact: true }).first().click();
  await expect(page).toHaveURL(/\/customer\/partners$/);

  const vendor = page.getByRole("link", { name: "Ghee Hiang", exact: true }).first();
  await expect(vendor).toBeVisible();
  await vendor.click();
  await expect(page).toHaveURL(/\/customer\/vendor\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Ghee Hiang", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('a[href*="/outlet/"]').first()).toBeVisible({ timeout: 20_000 });

  const outletPaths = await page.locator('a[href*="/outlet/"]').evaluateAll((anchors) =>
    anchors.map((anchor) => (anchor as HTMLAnchorElement).getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  expect(outletPaths.length).toBeGreaterThan(0);
  let selectedOutletPath: string | null = null;
  for (const outletPath of outletPaths) {
    await page.goto(outletPath);
    await expect(page.getByRole("heading", { name: /Available at/ })).toBeVisible({ timeout: 20_000 });
    const addToCart = page.getByRole("button", { name: "Add to Cart", exact: true }).first();
    if (await addToCart.count() && await addToCart.isEnabled()) {
      selectedOutletPath = outletPath;
      break;
    }
  }
  expect(selectedOutletPath).not.toBeNull();

  const productCard = page.locator("article").filter({ hasText: "Add to Cart" }).first();
  await expect(productCard).toBeVisible();
  await expect(productCard).toContainText(/RM\s?\d/);
  await expect(productCard).toContainText(/in stock/i);
  const purchase = productCard.getByRole("button", { name: "Add to Cart", exact: true });
  await expect(purchase).toBeEnabled();
  const outletUrl = page.url();
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /cart_items|\/api\/customer\/chat/.test(request.url())) mutations.push(request.url());
  });

  await purchase.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(outletUrl);
  await dialog.getByRole("button", { name: "Continue browsing", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(outletUrl);
  expect(mutations).toEqual([]);
});

test("Guest private navigation offers one login-page button, with registration available there", async ({ page }) => {
  await page.goto("/customer/explore");
  const cart = page.getByRole("link", { name: "Shopping cart", exact: true });
  await cart.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/customer\/explore$/);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/customer\/explore$/);
  await cart.click();
  await expect(dialog.getByRole("button", { name: "Create account", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Sign in / Register", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fcustomer%2Fcart$/);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByPlaceholder("Confirm password", { exact: true })).toBeVisible();
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
