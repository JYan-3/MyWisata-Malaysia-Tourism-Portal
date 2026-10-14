import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const process = vi.hoisted(() => vi.fn());
vi.mock('@/lib/refunds/process-refund', () => ({ processRefund: process }));
import { processQueuedEventRefunds } from '../process-queued-event-refunds';

function service(ids: string[], error: unknown = null) {
  const update = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));
  const db = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: ids.map(id => ({ id })), error }) }) }) }) }), update }) };
  return { db: db as unknown as SupabaseClient, update };
}

describe('automatic event refund outcomes', () => {
  beforeEach(() => vi.clearAllMocks());
  it('counts provider-pending separately from confirmed reimbursement and operator attention', async () => {
    const fake = service(['done','waiting','failed']);
    process.mockResolvedValueOnce({ok:true,data:{status:'processed'}}).mockResolvedValueOnce({ok:true,data:{status:'approved'}})
      .mockResolvedValueOnce({ok:false,code:'PROVIDER_UNAVAILABLE',message:'Retry requires operator attention'});
    expect(await processQueuedEventRefunds(fake.db)).toEqual({processed:1,awaitingProvider:1,handedToAdmin:1,error:null});
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({auto_process:false,provider_failure_code:'PROVIDER_UNAVAILABLE'}));
  });
  it('does not turn an unrecognized successful response into completed reimbursement', async () => {
    const fake=service(['unknown']); process.mockResolvedValue({ok:true,data:{status:'pending'}});
    expect(await processQueuedEventRefunds(fake.db)).toEqual({processed:0,awaitingProvider:0,handedToAdmin:1,error:null});
    expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({provider_failure_code:'REFUND_NOT_COMPLETED'}));
  });
  it('reports a failed queue read without attempting a provider refund', async () => {
    const fake=service([], {message:'Queue unavailable'});
    expect(await processQueuedEventRefunds(fake.db)).toEqual({processed:0,awaitingProvider:0,handedToAdmin:0,error:'Queue unavailable'});
    expect(process).not.toHaveBeenCalled();
  });
});
