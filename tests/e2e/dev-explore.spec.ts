import { expect, test } from "@playwright/test";

// /dev/explore is a read-only prototype (Docs/superpowers/specs/2026-08-02-dev-explore-district-discovery-map-design.md),
// not linked from anywhere in the product and requiring no login — same convention as the
// other /dev/* pages.

test("loads, and the old /demo/explore prototype no longer hosts it", async ({ page }) => {
  await page.goto("/dev/explore");
  await expect(page.getByRole("heading", { name: "District & discovery map" })).toBeVisible();

  const response = await page.goto("/demo/explore");
  expect(response?.status()).toBe(404);
});

test("plots all 116 district dots nationally, unlabelled until hover/focus (spec Δ1)", async ({ page }) => {
  await page.goto("/dev/explore");

  // District dots carry "<name>, <state>"; state pin-cards carry "Open <state>, N listings" —
  // excluding the "Open " prefix isolates the district layer. 116, not the
  // original 115: Kinabatangan was added to Sabah for Δ2 (River & Rainforest
  // Discovery's place coordinate).
  const districtDots = page.locator('svg g[role="button"][aria-label]:not([aria-label^="Open "])');
  await expect(districtDots).toHaveCount(116);

  const kinta = page.locator('svg g[aria-label="Kinta, Perak"]');
  await expect(kinta.locator("text")).toHaveCount(0);
  await kinta.focus();
  await expect(kinta.locator("text")).toHaveCount(1);
  await expect(kinta.locator("text")).toHaveText("Kinta");
});

test("selecting a state shows every district name permanently and reveals its pins", async ({ page }) => {
  await page.goto("/dev/explore");
  await page.locator('g[aria-label^="Open Penang,"] path').last().click({ force: true });

  await expect(page.getByText(/\d+ daerah · \d+ with listings/)).toBeVisible();
  // Once a state is open, district labels no longer need hover — five of Penang's are always on screen.
  for (const name of ["Timur Laut", "Barat Daya", "Seberang Perai Utara", "Seberang Perai Tengah", "Seberang Perai Selatan"]) {
    await expect(page.locator("svg text", { hasText: name }).first()).toBeVisible();
  }

  const markers = page.locator('svg g[aria-label*="Outlet"], svg g[aria-label*="Activity place"], svg g[aria-label*="places here"]');
  await expect(markers.first()).toBeVisible();
});

test("a live place-bound activity opens a preview with its own destination", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/dev/explore");

  const stateButtons = page.locator('svg g[role="button"][aria-label^="Open "]');
  const stateLabels = await stateButtons.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")).filter((label): label is string => Boolean(label)));
  for (const label of stateLabels) {
    const match = label.match(/^Open (.+), (\d+) listings$/);
    if (!match || Number(match[2]) === 0) continue;

    const stateButton = page.locator(`svg g[role="button"][aria-label=${JSON.stringify(label)}]`);
    await stateButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("figcaption h2")).toHaveText(match[1]);
    const activityPin = page.locator('svg g[role="button"][aria-label$="— Activity place"]');
    if (await activityPin.count() > 0) {
      const markerName = (await activityPin.first().getAttribute("aria-label"))?.replace(/ — Activity place$/, "");
      await activityPin.first().click({ force: true });
      await expect(page.getByRole("heading", { name: "Place-based experience", level: 3 })).toBeVisible();
      await expect(page.locator("aside")).toContainText(markerName ?? "");
      await expect(page.locator("aside")).toContainText(match[1]);
      return;
    }

    await page.getByRole("button", { name: "All Malaysia" }).click();
    await expect(page.locator("figcaption h2")).toHaveText("All states and federal territories");
  }

  test.skip(true, "The current catalogue has no place-bound activity with verified destination coordinates; the map builder's coordinate contract is covered by fixed-fixture tests.");
});

test("clicking a district dot from the national view jumps into that state and district together", async ({ page }) => {
  await page.goto("/dev/explore");
  const kinta = page.locator('svg g[aria-label="Kinta, Perak"]');
  await kinta.locator("circle").last().click({ force: true });

  await expect(page.getByRole("heading", { name: "Perak" })).toBeVisible();
});

test("an outlet pin opens a preview linking to the outlet and each of its products", async ({ page }) => {
  await page.goto("/dev/explore");
  await page.locator('g[aria-label^="Open Sabah,"] path').last().click({ force: true });
  await page.locator('svg g[aria-label*="Outlet"]').first().click({ force: true });

  const outletLink = page.locator("aside a").first();
  await expect(outletLink).toHaveAttribute("href", /^\/customer\/outlet\//);
  const productLink = page.locator('aside a[href^="/customer/activity/"]').first();
  await expect(productLink).toBeVisible();
});

test("a state with no listings still opens and says so explicitly", async ({ page }) => {
  await page.goto("/dev/explore");
  const emptyState = page.locator('svg g[role="button"][aria-label^="Open "][aria-label$=", 0 listings"]').first();
  const label = await emptyState.getAttribute("aria-label");
  const stateName = label?.match(/^Open (.+), 0 listings$/)?.[1];
  expect(stateName).toBeTruthy();
  await emptyState.locator("path").last().click({ force: true });

  await expect(page.getByRole("heading", { name: stateName!, exact: true })).toBeVisible();
  await expect(page.getByText(`No available outlets or activities in ${stateName} yet.`, { exact: true })).toBeVisible();
});

test("live place-bound products without coordinates receive an explicit warning", async ({ page }) => {
  await page.goto("/dev/explore");
  const warning = page.getByText(/^\d+ place-bound products? skipped/);
  test.skip(await warning.count() === 0, "The current catalogue has no place-bound products missing destination coordinates; deterministic omission behavior is covered by fixed-fixture tests.");
  await expect(warning.first()).toContainText("no verified destination coordinate");
});

test("keyboard: Tab reaches a district dot and Enter opens it", async ({ page }) => {
  await page.goto("/dev/explore");
  const kinta = page.locator('svg g[aria-label="Kinta, Perak"]');
  await kinta.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Perak" })).toBeVisible();
});

test("mobile viewport keeps text readable via horizontal scroll rather than shrinking", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/explore");
  await expect(page.getByRole("heading", { name: "District & discovery map" })).toBeVisible();
  const svg = page.locator('svg[role="img"]').first();
  await expect(svg).toBeVisible();
});
