import { expect, test } from "@playwright/test";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

async function readLiveCampaigns(page: import("@playwright/test").Page): Promise<PromotionCampaignPublic[]> {
  const response = await page.request.get("/api/customer/promotion-campaigns");
  expect(response.ok(), "the public campaign projection should be available").toBeTruthy();
  const payload = await response.json() as { data?: { campaigns?: PromotionCampaignPublic[] } };
  return payload.data?.campaigns ?? [];
}

test.describe("Customer vendor-fair event journeys", () => {
  test("loads the event map without MapLibre runtime failures", async ({ page }) => {
    const workerErrors: string[] = [];
    const runtimeErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("Worker failed to load")) {
        workerErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => runtimeErrors.push(`${error.message}\n${error.stack ?? ""}`));

    await page.goto("/customer/events", { waitUntil: "domcontentloaded" });
    const mapCanvas = page.locator(".mywisata-explore-map canvas.maplibregl-canvas");
    await expect(mapCanvas).toBeVisible();
    await page.waitForTimeout(1_500);
    const bounds = await mapCanvas.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) {
      await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.65);
      await page.mouse.wheel(0, -180);
      await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.65);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.65, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    expect(workerErrors).toEqual([]);
    expect(runtimeErrors).toEqual([]);
  });

  test("home, Browse all, event detail, and a participating vendor's stall page are all reachable", async ({ page }) => {
    test.setTimeout(150_000);
    const campaigns = await readLiveCampaigns(page);
    const campaign = campaigns.find((item) => item.vendors.length > 0);
    test.skip(!campaign, "no live campaign currently has an approved vendor registration to walk through");
    if (!campaign) return;
    const vendor = campaign.vendors[0];

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/customer");
    await expect(page.getByRole("heading", { name: campaign.title })).toBeVisible({ timeout: 45_000 });
    const browseAllEventsLink = page.getByRole("link", { name: "Browse all events" });
    await expect(browseAllEventsLink).toHaveAttribute("href", "/customer/events");
    await Promise.all([
      page.waitForURL("**/customer/events", { timeout: 45_000 }),
      browseAllEventsLink.click(),
    ]);
    await expect(page.getByRole("heading", { name: campaign.title })).toBeVisible({ timeout: 45_000 });

    await Promise.all([
      page.waitForURL(new RegExp(`/customer/events/${campaign.slug}$`), { timeout: 45_000 }),
      page.getByRole("link", { name: /View all/ }).first().click(),
    ]);
    await expect(page.getByRole("heading", { name: campaign.title })).toBeVisible();
    await expect(page.getByText(vendor.vendorName).first()).toBeVisible();

    await Promise.all([
      page.waitForURL(new RegExp(`/customer/events/${campaign.slug}/${vendor.vendorId}$`), { timeout: 45_000 }),
      page.getByRole("link", { name: "View stall" }).first().click(),
    ]);
    await expect(page.getByRole("heading", { name: vendor.vendorName })).toBeVisible();
    await expect(page.getByText(`Stall ${vendor.stalls[0].stallNumber}`).first()).toBeVisible();
  });

  test("an unpublished campaign slug returns a not-found page instead of an endless loading state", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/customer/events/no-such-campaign");
    await expect(page.getByRole("heading", { name: "This event is no longer available" })).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: "Back to events" }).last()).toHaveAttribute("href", "/customer/events");
    await expect(page.getByRole("status")).toHaveCount(0);
  });
});
