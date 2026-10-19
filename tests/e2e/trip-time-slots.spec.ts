import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { isOperatingHoursAtAvailable } from '../../lib/customer/operating-hours';
import { localEnv, signIn } from './helpers/demo';

// Trip planner fixed times + planned outlet at checkout.
// Plan: Docs/plans/2026-10-14-0055-trip-time-slots-and-outlet.md
// Isolation plan: Docs/plans/2026-10-16-0155-trip-e2e-account-isolation.md
// Each run creates and removes its own customer, trip, and cart.

test.setTimeout(300_000);
test.describe.configure({ retries: 0 });
test.use({ actionTimeout: 30_000 });

const SUPABASE_URL = localEnv('NEXT_PUBLIC_SUPABASE_URL')!;
const SERVICE_KEY = localEnv('SUPABASE_SERVICE_ROLE_KEY')!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const SERVER_HEADERS = { 'User-Agent': 'mywisata-e2e (node)', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type TestCustomer = { id: string; email: string; password: string };
const testCustomerIds = new Set<string>();

async function createTestCustomer(): Promise<TestCustomer> {
  const email = `trip-time-${randomUUID()}@demo.local`;
  const password = `Trip-E2E-${randomUUID()}!`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Trip time slots E2E' },
  });
  if (error) throw new Error(`create a unique Trip E2E customer: ${error.message}`);
  if (!data.user) throw new Error('Supabase Auth did not return the created Trip E2E customer');
  // Register immediately so the outer finally can clean it up even if later
  // setup or assertions fail before this helper returns.
  testCustomerIds.add(data.user.id);
  return { id: data.user.id, email, password };
}

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

  type SlotRow = { id: string; product_id: string; outlet_id: string; starts_at: string; products: { name: string } };
  const [slot] = await rest<SlotRow[]>(request, 'GET',
    'booking_slots?select=id,product_id,outlet_id,starts_at,products!inner(name,status,review_status,categories!inner(slug))'
    + '&products.status=eq.active&products.review_status=eq.approved&products.categories.slug=eq.activity'
    + `&status=eq.available&booked=eq.0&starts_at=gte.${date}T09:00:00%2B08:00&starts_at=lt.${date}T13:00:00%2B08:00&order=starts_at&limit=1`);
  expect(slot, 'a bookable activity with an open slot tomorrow morning').toBeTruthy();
  const daySlots = await rest<{ outlet_id: string; starts_at: string }[]>(request, 'GET',
    `booking_slots?select=outlet_id,starts_at&product_id=eq.${slot.product_id}`
    + `&starts_at=gte.${date}T00:00:00%2B08:00&starts_at=lt.${date}T23:59:59%2B08:00`);
  const expectedSlotTimes = [...new Set(daySlots
    .filter((candidate) => candidate.outlet_id === slot.outlet_id)
    .map((candidate) => malaysiaClock(candidate.starts_at)))].sort();

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
  let customer: TestCustomer | null = null;
  try {
    customer = await createTestCustomer();
    await expect.poll(async () => rest<{ id: string }[]>(request, 'GET', `users?select=id&id=eq.${customer!.id}`), {
      message: 'Auth signup trigger creates the matching public customer row',
    }).toHaveLength(1);
    await rest(request, 'POST', 'trips', { id: tripId, user_id: customer.id, name: 'E2E trip time slots', start_date: date, end_date: date });
    await rest(request, 'POST', 'trip_items', [
      // 00:26 is the kind of free-typed time the old picker allowed.
      { trip_id: tripId, experience_id: slot.product_id, outlet_id: slot.outlet_id, sequence: 0, scheduled_date: date, scheduled_time: '00:26', source: 'vendor', lat: outletById.get(slot.outlet_id)!.lat, lng: outletById.get(slot.outlet_id)!.lng, label: slot.products.name },
      { trip_id: tripId, experience_id: food!.id, outlet_id: food!.outlet_id, sequence: 1, scheduled_date: date, scheduled_time: null, source: 'vendor', lat: outletById.get(food!.outlet_id)!.lat, lng: outletById.get(food!.outlet_id)!.lng, label: food!.name },
    ]);
    const savedTripTime = async (experienceId: string) => {
      const rows = await rest<{ scheduled_time: string | null }[]>(request, 'GET',
        `trip_items?select=scheduled_time&trip_id=eq.${tripId}&experience_id=eq.${experienceId}`);
      return rows[0]?.scheduled_time?.slice(0, 5) ?? null;
    };

    // The dev server compiles /login on first hit; typing before hydration is lost.
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await signIn(page, customer.email, customer.password);
    await page.request.post('/api/locale', { data: { locale: 'en' } });
    await page.goto(`/customer/trip/${tripId}`);

    // Bookable activity: the old free time is flagged, and only real slots are offered.
    const itinerary = page.getByRole('main', { name: 'Trip itinerary' });
    const activityRow = itinerary.locator('li').filter({ hasText: slot.products.name }).first();
    await expect(activityRow.locator('[data-trip-time-problem]')).toContainText('no longer offered', { timeout: 90_000 });
    const slotSelect = activityRow.locator('select[data-trip-time-select="slots"]');
    const slotTime = malaysiaClock(slot.starts_at);
    const offeredSlotTimes = await slotSelect.locator('option').evaluateAll((options) => options
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value && value !== '00:26'));
    expect([...new Set(offeredSlotTimes)].sort()).toEqual(expectedSlotTimes);
    await expect(slotSelect.locator(`option[value="${slotTime}"]`)).toHaveCount(1);
    await slotSelect.selectOption(slotTime);
    await expect(activityRow.locator('[data-trip-time-problem]')).toHaveCount(0);
    await expect.poll(() => savedTripTime(slot.product_id), {
      message: 'the selected outlet slot is persisted on the activity trip stop',
      timeout: 30_000,
    }).toBe(slotTime);

    // Food: only 30-minute steps inside tomorrow's opening hours.
    const foodRow = itinerary.locator('li').filter({ hasText: food!.name }).first();
    await foodRow.getByRole('button', { name: /^Time for/ }).click();
    const hoursSelect = foodRow.locator('select[data-trip-time-select="hours"]');
    const values = (await hoursSelect.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).filter(Boolean);
    const expectedHours = Array.from({ length: 48 }, (_, index) => {
      const minute = index * 30;
      return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    }).filter((value) => isOperatingHoursAtAvailable(value, { [weekday]: foodHours }, [weekday]));
    expect(values).toEqual(expectedHours);
    const lastEnabled = await hoursSelect.locator('option:not([disabled])').last().getAttribute('value');
    await hoursSelect.selectOption(lastEnabled!);
    await expect.poll(() => savedTripTime(food!.id), {
      message: 'the selected operational-hours time is persisted on the food trip stop',
      timeout: 30_000,
    }).toBe(lastEnabled);

    // Buy: both lines land in the cart at the planned outlet, the activity on the chosen slot.
    await itinerary.getByRole('button', { name: 'Checkout (2 items)', exact: true }).click();
    await page.waitForURL('**/customer/cart', { timeout: 60_000 });
    await expect(page.getByRole('checkbox', { name: `Select ${slot.products.name}`, exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: `Select ${food!.name}`, exact: true })).toBeChecked();
    const cartAfter = await rest<{ id: string; slot_id: string | null; variant_id: string | null; outlet_id: string }[]>(
      request, 'GET', `cart_items?select=id,slot_id,variant_id,outlet_id,carts!inner(user_id)&carts.user_id=eq.${customer.id}`);
    expect(cartAfter.some((line) => line.slot_id === slot.id && line.outlet_id === slot.outlet_id)).toBe(true);
    const foodVariantIds = new Set(food!.product_variants.map((variant) => variant.id));
    expect(cartAfter.some((line) => line.variant_id && foodVariantIds.has(line.variant_id) && line.outlet_id === food!.outlet_id)).toBe(true);

    await page.getByRole('link', { name: 'Proceed to checkout (2)', exact: true }).click();
    await page.waitForURL('**/customer/checkout', { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Items to Reserve (2)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: slot.products.name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: food!.name, exact: true })).toBeVisible();
  } finally {
    for (const customerId of testCustomerIds) {
      try {
        await rest(request, 'DELETE', `trips?id=eq.${tripId}`);
        const carts = await rest<{ id: string }[]>(request, 'GET', `carts?select=id&user_id=eq.${customerId}`);
        for (const cart of carts) {
          const items = await rest<{ id: string }[]>(request, 'GET', `cart_items?select=id&cart_id=eq.${cart.id}`);
          for (const item of items) await rest(request, 'DELETE', `cart_items?id=eq.${item.id}`);
          await rest(request, 'DELETE', `carts?id=eq.${cart.id}`);
        }
      } finally {
        try {
          await rest(request, 'DELETE', `users?id=eq.${customerId}`);
        } finally {
          const { error } = await service.auth.admin.deleteUser(customerId);
          expect(error, 'delete temporary Supabase Auth customer').toBeNull();
          testCustomerIds.delete(customerId);
        }
      }
    }
  }
});
