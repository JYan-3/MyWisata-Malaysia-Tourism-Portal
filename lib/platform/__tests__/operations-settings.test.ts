import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ maybeSingle: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({
  from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })) })) })),
}) }));

import { isPlatformOperationEnabled } from '../operations-settings';

describe('platform operation switches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads only the allowlisted switch from the private settings table', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { value: 'true' }, error: null });
    await expect(isPlatformOperationEnabled('email.pause_custom_delivery')).resolves.toBe(true);
  });

  it('fails closed when a seeded row is missing or malformed', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(isPlatformOperationEnabled('operations.pause_new_orders')).rejects.toThrow('platform_operation_setting_missing');
    mocks.maybeSingle.mockResolvedValueOnce({ data: { value: 'maybe' }, error: null });
    await expect(isPlatformOperationEnabled('operations.pause_new_orders')).rejects.toThrow('platform_operation_setting_invalid');
  });

  it('fails closed when the private settings read fails', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: new Error('private database failure') });
    await expect(isPlatformOperationEnabled('operations.pause_new_orders')).rejects.toThrow('platform_operation_settings_unavailable');
  });
});
