import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ACCOUNTS, localEnv, signIn } from './helpers/demo';

// Trip planner fixed times + planned outlet at checkout.
// Plan: Docs/plans/2026-10-14-0055-trip-time-slots-and-outlet.md
// Creates its own trip for customer3 with the service key and removes it (and any
// cart lines it added) afterwards.

test.setTimeout(300_000);
test.describe.configure({ retries: 0 });
test.use({ actionTimeout: 30_000 });

const SUPABASE_URL = localEnv('NEXT_PUBLIC_SUPABASE_URL')!;
const SERVICE_KEY = localEnv('SUPABASE_SERVICE_ROLE_KEY')!;
const SERVER_HEADERS = { 'User-Agent': 'mywisata-e2e (node)', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

async function rest<T>(request: APIRequestContext, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<T> {
  const res = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...SERVER_HEADERS, Prefer: 'return=representation' }, data });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (res.status() === 204 ? [] : await res.json()) as T;
}

function malaysiaDate(offsetDays: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

function malaysiaClock(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

test('stops offer only real slots or opening hours, and Buy keeps the planned outlet and slot', async ({ page, request }) => {
  const date = malaysiaDate(1);
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00+08:00`).getUTCDay()];

  const [{ id: userId }] = await rest<{ id: string }[]>(request, 'GET', `users?select=id&email=eq.${ACCOUNTS.customer3}`);

  type SlotRow = { id: string; product_id: string; outlet_id: string; starts_at: string; products: { name: string } };
  const [slot] = await rest<SlotRow[]>(request, 'GET',
    'booking_slots?select=id,product_id,outlet_id,starts_at,products!inner(name,status,review_status,categories!inner(slug))'
    + '&products.status=eq.active&products.review_status=eq.approved&products.categories.slug=eq.activity'
    + `&status=eq.available&booked=eq.0&starts_at=gte.${date}T09:00:00%2B08:00&starts_at=lt.${date}T13:00:00%2B08:00&order=starts_at&limit=1`);
  expect(slot, 'a bookable activity with an open slot tomorrow morning').toBeTruthy();

  type FoodRow = { id: string; name: string; outlet_id: string; product_variants: { id: string; inventory: { outlet_id: string; quantity: number; reserved: number }[] }[] };
  const foods = await rest<FoodRow[]>(request, 'GET',
    'products?select=id,name,outlet_id,categories!inner(slug),product_variants!inner(id,is_active,inventory!inner(outlet_id,quantity,reserved))'
    + '&requires_booking=eq.false&status=eq.active&review_status=eq.approved&categories.slug=eq.food&outlet_id=not.is.null'
    + '&product_variants.is_active=eq.true&product_variants.inventory.quantity=gt.5&limit=20');
  const food = foods.find((row) => row.product_variants.some((variant) => variant.inventory.some((stock) => stock.outlet_id === row.outlet_id && stock.quantity - stock.reserved > 0)));
  expect(food, 'a food listing with stock at its own outlet').toBeTruthy();

  const outlets = await rest<{ id: string; lat: number; lng: number; operating_hours: Record<string, { open: string; close: string; closed?: boolean }> }[]>(
    request, 'GET', `outlets?select=id,lat,lng,operating_hours&id=in.(${slot.outlet_id},${food!.outlet_id})`);
  const outletById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const foodHours = outletById.get(food!.outlet_id)!.operating_hours[weekday];
  test.skip(!foodHours || Boolean(foodHours.closed), 'food outlet is closed tomorrow');

  const tripId = randomUUID();
  const cartBefore = await rest<{ id: string; quantity: number }[]>(request, 'GET', `cart_items?select=id,quantity,carts!inner(user_id)&carts.user_id=eq.${userId}`);
  try {
    await rest(request, 'POST', 'trips', { id: tripId, user_id: userId, name: 'E2E trip time slots', start_date: date, end_date: date });
    await rest(request, 'POST', 'trip_items', [
      // 00:26 is the kind of free-typed time the old picker allowed.
      { trip_id: tripId, experience_id: slot.product_id, outlet_id: slot.outlet_id, sequence: 0, scheduled_date: date, scheduled_time: '00:26', source: 'vendor', lat: outletById.get(slot.outlet_id)!.lat, lng: outletById.get(slot.outlet_id)!.lng, label: slot.products.name },
      { trip_id: tripId, experience_id: food!.id, outlet_id: food!.outlet_id, sequence: 1, scheduled_date: date, scheduled_time: null, source: 'vendor', lat: outletById.get(food!.outlet_id)!.lat, lng: outletById.get(food!.outlet_id)!.lng, label: food!.name },
    ]);

    // The dev server compiles /login on first hit; typing before hydration is lost.
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await signIn(page, ACCOUNTS.customer3);
    await page.request.post('/api/locale', { data: { locale: 'en' } });
    await page.goto(`/customer/trip/${tripId}`);

    // Bookable activity: the old free time is flagged, and only real slots are offered.
    const itinerary = page.getByRole('main', { name: 'Trip itinerary' });
    const activityRow = itinerary.locator('li').filter({ hasText: slot.products.name }).first();
    await expect(activityRow.locator('[data-trip-time-problem]')).toContainText('no longer offered', { timeout: 90_000 });
    const slotSelect = activityRow.locator('select[data-trip-time-select="slots"]');
    const slotTime = malaysiaClock(slot.starts_at);
    await expect(slotSelect.locator(`option[value="${slotTime}"]`)).toHaveCount(1);
    await slotSelect.selectOption(slotTime);
    await expect(activityRow.locator('[data-trip-time-problem]')).toHaveCount(0);

    // Food: only 30-minute steps inside tomorrow's opening hours.
    const foodRow = itinerary.locator('li').filter({ hasText: food!.name }).first();
    await foodRow.getByRole('button', { name: /^Time for/ }).click();
    const hoursSelect = foodRow.locator('select[data-trip-time-select="hours"]');
    const values = (await hoursSelect.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).filter(Boolean);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value >= foodHours.open && value < foodHours.close && /:(00|30)$/.test(value))).toBe(true);
    const lastEnabled = await hoursSelect.locator('option:not([disabled])').last().getAttribute('value');
    await hoursSelect.selectOption(lastEnabled!);

    // Buy: both lines land in the cart at the planned outlet, the activity on the chosen slot.
    await itinerary.getByRole('button', { name: 'Checkout (2 items)', exact: true }).click();
    await page.waitForURL('**/customer/cart', { timeout: 60_000 });
    const cartAfter = await rest<{ id: string; slot_id: string | null; variant_id: string | null; outlet_id: string }[]>(
      request, 'GET', `cart_items?select=id,slot_id,variant_id,outlet_id,carts!inner(user_id)&carts.user_id=eq.${userId}`);
    expect(cartAfter.some((line) => line.slot_id === slot.id && line.outlet_id === slot.outlet_id)).toBe(true);
    const foodVariantIds = new Set(food!.product_variants.map((variant) => variant.id));
    expect(cartAfter.some((line) => line.variant_id && foodVariantIds.has(line.variant_id) && line.outlet_id === food!.outlet_id)).toBe(true);
  } finally {
    await rest(request, 'DELETE', `trips?id=eq.${tripId}`);
    const before = new Map(cartBefore.map((line) => [line.id, line.quantity]));
    const after = await rest<{ id: string; quantity: number }[]>(request, 'GET', `cart_items?select=id,quantity,carts!inner(user_id)&carts.user_id=eq.${userId}`);
    for (const line of after) {
      if (!before.has(line.id)) await rest(request, 'DELETE', `cart_items?id=eq.${line.id}`);
      else if (before.get(line.id) !== line.quantity) await rest(request, 'PATCH', `cart_items?id=eq.${line.id}`, { quantity: before.get(line.id) });
    }
  }
});
