import { describe, expect, it, vi } from 'vitest';
import { getFeaturedEventPromotions } from '@/lib/customer/event-promotions';

const row = {
  id: 'evt-1', vendor_id: 'vendor-1', title: 'Penang Food Fair', details: 'd',
  starts_on: '2027-01-15', ends_on: '2027-01-17', poster_url: 'https://x/p.png', vendors: { name: 'Vendor One' },
};

describe('getFeaturedEventPromotions', () => {
  it('queries paid, not-yet-ended events ordered soonest first and maps the vendor name', async () => {
    const eq = vi.fn().mockReturnThis();
    const gte = vi.fn().mockReturnThis();
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn().mockResolvedValue({ data: [row], error: null });
    const select = vi.fn().mockReturnValue({ eq, gte, order, limit });
    const from = vi.fn().mockReturnValue({ select });
    const db = { from } as unknown as Parameters<typeof getFeaturedEventPromotions>[0];

    const result = await getFeaturedEventPromotions(db, 8);

    expect(from).toHaveBeenCalledWith('vendor_event_promotions');
    expect(eq).toHaveBeenCalledWith('status', 'paid');
    expect(gte).toHaveBeenCalledWith('ends_on', expect.any(String));
    expect(order).toHaveBeenCalledWith('starts_on', { ascending: true });
    expect(limit).toHaveBeenCalledWith(8);
    expect(result).toEqual([{
      id: 'evt-1', vendorId: 'vendor-1', vendorName: 'Vendor One', title: 'Penang Food Fair',
      details: 'd', startDate: '2027-01-15', endDate: '2027-01-17', posterUrl: 'https://x/p.png',
    }]);
  });

  it('throws a descriptive error when the query fails', async () => {
    const chain = { eq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) };
    const db = { from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) }) } as unknown as Parameters<typeof getFeaturedEventPromotions>[0];
    await expect(getFeaturedEventPromotions(db)).rejects.toThrow('Failed to load featured event promotions: boom');
  });
});
