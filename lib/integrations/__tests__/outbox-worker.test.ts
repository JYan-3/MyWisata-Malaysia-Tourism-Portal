import { describe, expect, it, vi } from 'vitest';
import { processOutboxBatch } from '@/lib/integrations/outbox-worker';

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from '@/lib/supabase/service';

function configureOutbox(
  events: unknown[],
  updateMock = vi.fn(),
  readResult: { data: unknown[] | null; error: { message: string } | null } = { data: events, error: null },
) {
  const claimQuery = {
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'event-1' }, error: null }),
  };
  const writeQuery = {
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
  };
  const dueQuery = {
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(readResult),
  };
  updateMock.mockReturnValueOnce(claimQuery).mockReturnValue(writeQuery);
  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(dueQuery),
      update: updateMock,
    }),
  } as unknown as ReturnType<typeof createServiceClient>);
  return { claimQuery, dueQuery, updateMock };
}

describe('sync outbox processor', () => {
  it('requires a dispatcher before it creates a service client or reads pending events', async () => {
    await expect(processOutboxBatch(undefined as never)).rejects.toThrow('outbox_dispatcher_required');
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it('surfaces a failed outbox read instead of reporting an empty successful batch', async () => {
    configureOutbox([], vi.fn(), { data: null, error: { message: 'db unavailable' } });

    await expect(processOutboxBatch(vi.fn())).rejects.toThrow('outbox_load_failed');
  });

  it('processes pending outbox events and marks them delivered on dispatcher success', async () => {
    const { claimQuery, dueQuery, updateMock } = configureOutbox([{
      id: 'event-1',
      aggregate_type: 'slot_capacity',
      aggregate_id: 'slot-123',
      event_type: 'slot.updated',
      payload: { booked: 5, capacity: 10 },
      status: 'pending',
      retry_count: 0,
    }]);

    const dispatcherMock = vi.fn().mockResolvedValue(undefined);
    const result = await processOutboxBatch(dispatcherMock);

    expect(result.processed).toBe(1);
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(dispatcherMock).toHaveBeenCalledTimes(1);
    expect(dueQuery.in).toHaveBeenCalledWith('status', ['pending', 'failed', 'processing']);
    expect(dueQuery.lt).toHaveBeenCalledWith('retry_count', 5);
    expect(dueQuery.or).toHaveBeenCalledWith(expect.stringContaining('lease_expires_at.lt.'));
    expect(claimQuery.or).toHaveBeenCalledWith(expect.stringContaining('lease_expires_at.lt.'));
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({ status: 'processing', lease_expires_at: expect.any(String) });
    expect(updateMock.mock.calls[1]?.[0]).toMatchObject({ status: 'delivered', lease_expires_at: null });
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it('handles dispatcher failure with retry backoff update', async () => {
    configureOutbox([{
      id: 'event-2',
      aggregate_type: 'slot_capacity',
      aggregate_id: 'slot-123',
      event_type: 'slot.booked',
      payload: { booked: 10, capacity: 10 },
      status: 'pending',
      retry_count: 1,
    }]);

    const dispatcherMock = vi.fn().mockRejectedValue(new Error('Network timeout to partner API'));
    const result = await processOutboxBatch(dispatcherMock);

    expect(result.processed).toBe(1);
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('does not count a dispatch as delivered when the delivery state cannot be persisted', async () => {
    const updateMock = vi.fn();
    const { claimQuery } = configureOutbox([{
      id: 'event-3',
      aggregate_type: 'slot_capacity',
      aggregate_id: 'slot-123',
      event_type: 'slot.updated',
      payload: { booked: 5, capacity: 10 },
      status: 'pending',
      retry_count: 0,
    }], updateMock);
    const failedDeliveryWrite = { eq: vi.fn().mockResolvedValue({ error: { message: 'database unavailable' } }) };
    const retryWrite = {
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
    };
    updateMock.mockReset()
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(failedDeliveryWrite)
      .mockReturnValueOnce(retryWrite);

    const result = await processOutboxBatch(vi.fn().mockResolvedValue(undefined));

    expect(result).toEqual({ processed: 1, delivered: 0, failed: 1 });
    expect(updateMock).toHaveBeenCalledTimes(3);
    expect(updateMock.mock.calls[2]?.[0]).toMatchObject({ status: 'pending', retry_count: 1, last_error: 'delivery_state_update_failed' });
  });

  it('moves to terminal failed state when delivery could not be recorded on the final retry', async () => {
    const updateMock = vi.fn();
    const { claimQuery } = configureOutbox([{
      id: 'event-final', aggregate_type: 'slot_capacity', aggregate_id: 'slot-123',
      event_type: 'slot.updated', payload: {}, status: 'pending', retry_count: 4,
    }], updateMock);
    const failedDeliveryWrite = { eq: vi.fn().mockResolvedValue({ error: { message: 'database unavailable' } }) };
    const terminalRetryWrite = {
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
    };
    updateMock.mockReset()
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(failedDeliveryWrite)
      .mockReturnValueOnce(terminalRetryWrite);

    const result = await processOutboxBatch(vi.fn().mockResolvedValue(undefined));

    expect(result).toEqual({ processed: 1, delivered: 0, failed: 1 });
    expect(updateMock.mock.calls[2]?.[0]).toMatchObject({ status: 'failed', retry_count: 5, lease_expires_at: null });
  });

  it('never selects an event after its retry ceiling has been reached', async () => {
    const { dueQuery } = configureOutbox([]);

    await processOutboxBatch(vi.fn());

    expect(dueQuery.lt).toHaveBeenCalledWith('retry_count', 5);
  });
});
