import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), createServiceClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from })) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));

import { authorizeVendor } from '../vendor-authorization';

function chain(result: unknown) {
  const value = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
  value.select.mockReturnValue(value);
  value.eq.mockReturnValue(value);
  value.maybeSingle.mockResolvedValue(result);
  value.then.mockImplementation((resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject));
  return value;
}

describe('authorizeVendor draft owner access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    mocks.createServiceClient.mockReturnValue({});
  });

  it('allows the legal owner to edit a pending vendor draft', async () => {
    const vendor = chain({ data: { id: 'vendor-1', owner_id: 'owner-1', status: 'pending' }, error: null });
    const outlets = chain({ data: [], error: null });
    mocks.from.mockImplementation((table: string) => table === 'vendors' ? vendor : outlets);

    const result = await authorizeVendor('vendor-1', ['vendor_owner']);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.access.isOwner).toBe(true);
  });
});

describe('authorizeVendor event vendors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    mocks.createServiceClient.mockReturnValue({});
  });

  function eventVendor() {
    const vendor = chain({ data: { id: 'vendor-1', owner_id: 'owner-1', status: 'approved', kind: 'event' }, error: null });
    const outlets = chain({ data: [], error: null });
    mocks.from.mockImplementation((table: string) => table === 'vendors' ? vendor : outlets);
  }

  it('rejects the owner of an event vendor on routes that do not opt in', async () => {
    eventVendor();
    const result = await authorizeVendor('vendor-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      expect((await result.response.json()).error.code).toBe('EVENT_VENDOR_FORBIDDEN');
    }
  });

  it('allows the owner of an event vendor on opted-in routes', async () => {
    eventVendor();
    const result = await authorizeVendor('vendor-1', undefined, { allowEventVendor: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.access.isOwner).toBe(true);
  });
});
