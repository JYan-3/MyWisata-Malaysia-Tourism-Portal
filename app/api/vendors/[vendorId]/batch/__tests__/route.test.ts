import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorizeVendor: vi.fn(), admit: vi.fn(), getOutletProductIds: vi.fn(), rows: {} as Record<string, Record<string, unknown>[]>, mutations: [] as string[] }));
vi.mock('@/lib/vendor-authorization', () => ({ authorizeVendor: mocks.authorizeVendor }));
vi.mock('@/lib/vendor/booking-checkin', () => ({ checkInBooking: mocks.admit }));
vi.mock('@/backend/domains/catalogue', () => ({ getOutletProductIds: mocks.getOutletProductIds }));
vi.mock('@/lib/vendor-notifications/emit', () => ({ emitVendorNotification: vi.fn().mockResolvedValue(null) }));
import { POST } from '../route';
const assigned = '00000000-0000-4000-8000-000000000001';
const foreign = '00000000-0000-4000-8000-000000000002';
const booking = '00000000-0000-4000-8000-000000000003';
function db() {
  return { from(table: string) {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let mutation = false;
    const query = {
      select: vi.fn().mockReturnThis(),
      eq(key: string, value: unknown) { filters.push(row => key.includes('.') ? (row[key.split('.')[0]] as Record<string, unknown>)?.[key.split('.')[1]] === value : row[key] === value); return query; },
      in(key: string, values: unknown[]) { filters.push(row => key.includes('.') ? values.includes((row[key.split('.')[0]] as Record<string, unknown>)?.[key.split('.')[1]]) : values.includes(row[key])); return query; },
      update: vi.fn(() => { mutation = true; return query; }),
      then(resolve: (value: unknown) => unknown) {
        const rows = (mocks.rows[table] || []).filter(row => filters.every(filter => filter(row)));
        if (mutation) mocks.mutations.push(...rows.map(row => String(row.id)));
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return query;
  }};
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = {}; mocks.mutations = [];
  mocks.getOutletProductIds.mockResolvedValue(new Set());
  mocks.authorizeVendor.mockResolvedValue({ ok: true, access: { userId: 'owner', isOwner: true, isOutletManager: false, outletIds: [assigned], serviceDb: db() } });
  mocks.admit.mockResolvedValue(new Response(JSON.stringify({ data: { status: 'checked_in' } }), { status: 200 }));
});
async function request(entity: string, action: string, ids: string[]) {
  return POST(new Request('http://localhost/batch', { method: 'POST', body: JSON.stringify({ entity, action, ids }) }), { params: Promise.resolve({ vendorId: 'vendor' }) });
}
it('rejects approved owner product mutations before service writes', async () => {
  expect((await request('products', 'archive', [booking])).status).toBe(403);
  expect(mocks.mutations).toEqual([]);
});
it('rejects foreign explicit slots and slots with existing bookings for owners', async () => {
  mocks.rows.booking_slots = [{ id: foreign, outlet_id: foreign, status: 'available', booked: 0 }, { id: booking, outlet_id: assigned, status: 'available', booked: 1 }];
  const response = await request('slots', 'cancel', [foreign, booking]);
  expect(response.status).toBe(200);
  expect(mocks.mutations).toEqual([]);
  expect((await response.json()).data.updated).toBe(0);
});
it('uses paid ticket admission for scoped bookings, including slotless tickets', async () => {
  mocks.rows.bookings = [{ id: booking, status: 'confirmed', slot_id: null, order_items: { vendor_id: 'vendor', outlet_id: assigned } }, { id: foreign, status: 'confirmed', order_items: { vendor_id: 'other', outlet_id: foreign } }];
  const response = await request('bookings', 'check_in', [booking, foreign]);
  expect(response.status).toBe(200);
  expect(mocks.admit).toHaveBeenCalledTimes(1);
  expect(mocks.admit.mock.calls[0][2]).toBe(booking);
  expect(mocks.mutations).toEqual([]);
  expect((await response.json()).data.updated).toBe(1);
});
it('cannot bypass the refund lifecycle with direct booking cancellation', async () => {
  expect((await request('bookings', 'cancel', [booking])).status).toBe(409);
  expect(mocks.mutations).toEqual([]);
});
it('batch updates a shared product offered by the assigned outlet', async () => {
  const sharedProduct = '00000000-0000-4000-8000-000000000004';
  mocks.authorizeVendor.mockResolvedValue({ ok: true, access: {
    userId: 'manager', isOwner: false, isOutletManager: true, outletIds: [assigned], serviceDb: db(),
  } });
  mocks.rows.products = [{ id: sharedProduct, vendor_id: 'vendor', outlet_id: null }];
  mocks.rows.outlet_offers = [{ product_id: sharedProduct, outlet_id: assigned, status: 'active' }];
  mocks.getOutletProductIds.mockResolvedValue(new Set([sharedProduct]));

  const response = await request('products', 'archive', [sharedProduct]);

  expect(response.status).toBe(200);
  expect(mocks.mutations).toEqual([sharedProduct]);
  expect((await response.json()).data.updated).toBe(1);
});
