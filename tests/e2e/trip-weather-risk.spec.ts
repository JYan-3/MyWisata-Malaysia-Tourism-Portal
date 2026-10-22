import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createTestCustomer, installTripFixtureCleanup, rest, signInTestCustomer } from "./helpers/trip-fixture";

test.setTimeout(180_000);
installTripFixtureCleanup();

async function switchLanguage(page: Page, locale: "en" | "ms" | "zh-CN") {
  const response = await page.request.post("/api/locale", { data: { locale } });
  expect(response.status(), `Locale update to ${locale} failed`).toBe(200);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

function tomorrowIsoDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test("a scheduled trip day shows expandable forecast risk evidence and attribution", async ({ page }) => {
  const tripId = randomUUID();
  const customer = await createTestCustomer(tripId, page.request);
  const date = tomorrowIsoDate();
  const trip = (await rest<Array<{id:string}>>(page.request,"POST","trips",{
    id: tripId,
    user_id: customer.id,
    name: "Weather acceptance trip",
    start_date: date,
    end_date: date,
  }))[0];
  const item = {
    id: randomUUID(),
    trip_id: trip.id,
    experience_id: null,
    sequence: 0,
    scheduled_date: date,
    scheduled_time: "10:00",
    source: "location",
    kind: "custom",
    lat: 5.4141,
    lng: 100.3288,
    label: "George Town",
  };
  await rest<unknown>(page.request,"POST","trip_items",item);

  await signInTestCustomer(page, customer);

  let weatherRequest: { tripId?: string; targets?: Array<{ key: string; date: string; itemId: string }> } | null = null;
  await page.route("**/api/weather/forecast", async (route) => {
    weatherRequest = route.request().postDataJSON();
    const targets = weatherRequest?.targets ?? [];
    const results = Object.fromEntries(targets.map((target) => [target.key, {
      target: { ...target, latitude: item.lat, longitude: item.lng, label: item.label, kind: "day" },
      forecast: {
        availability: "forecast",
        provider: "open_meteo",
        latitude: item.lat,
        longitude: item.lng,
        timezone: "Asia/Kuala_Lumpur",
        date,
        fetchedAt: new Date().toISOString(),
        stale: false,
        evidence: {
          weatherCode: 95,
          temperatureMaxC: 31,
          temperatureMinC: 25,
          apparentTemperatureMaxC: 36,
          precipitationProbabilityMax: 88,
          precipitationSumMm: 14.4,
          windGustMaxKmh: 43.2,
          uvIndexMax: 8.4,
        },
      },
      risk: {
        level: "high",
        reasons: ["thunderstorm", "heavy_rain", "strong_wind", "extreme_uv"],
        ruleVersion: "2026-09-v1",
      },
    }]));

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { results } }),
    });
  });

  await page.goto(`/customer/trip/${trip.id}`);
  await switchLanguage(page, "en");

  const weatherSummary = page.locator("summary").filter({ hasText: "Thunderstorm risk" });
  await expect(weatherSummary).toBeVisible({ timeout: 15_000 });
  expect(weatherRequest).toMatchObject({
    tripId: trip.id,
    targets: [{ date, itemId: item.id }],
  });

  await weatherSummary.click();
  await expect(page.getByText("Based on forecast", { exact: true })).toBeVisible();
  await expect(page.getByText("Forecast near George Town", { exact: true })).toBeVisible();
  await expect(page.getByText("Rain 88% · 14.4 mm", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Weather data by Open-Meteo" }).first()).toHaveAttribute("href", "https://open-meteo.com/");
  await expect(page.getByText(/official warning/i)).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await switchLanguage(page, "zh-CN");
  const chineseSummary = page.locator("summary").filter({ hasText: "雷雨风险" });
  await expect(chineseSummary).toBeVisible();
  await chineseSummary.click();
  await expect(page.getByRole("link", { name: "天气数据由 Open-Meteo 提供" }).first()).toBeVisible();

  await switchLanguage(page, "ms");
  const malaySummary = page.locator("summary").filter({ hasText: "Risiko ribut petir" });
  await expect(malaySummary).toBeVisible();
  await malaySummary.click();
  await expect(page.getByRole("link", { name: "Data cuaca oleh Open-Meteo" }).first()).toBeVisible();
});
