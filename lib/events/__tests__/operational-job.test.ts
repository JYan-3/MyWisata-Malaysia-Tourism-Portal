import { describe, expect, it, vi } from 'vitest';
import { runEventOperationalJob } from '../operational-job';
import type { SupabaseClient } from '@supabase/supabase-js';

it('does not execute a financial sweep when its durable start record fails', async () => {
  const execute=vi.fn();
  const builder={select:()=>builder,single:async()=>({data:null,error:{message:'unavailable'}})};
  const service={from:()=>({insert:()=>builder})} as unknown as SupabaseClient;
  await expect(runEventOperationalJob(service,'process_event_refunds',execute)).rejects.toThrow('job_record_unavailable');
  expect(execute).not.toHaveBeenCalled();
});

describe('durable run completion',()=>{
 it('records failures without storing raw provider payloads',async()=>{
  const update=vi.fn(()=>({eq:async()=>({error:null})}));
  const builder={select:()=>builder,single:async()=>({data:{id:'run'},error:null})};
  const service={from:()=>({insert:()=>builder,update})} as unknown as SupabaseClient;
  await expect(runEventOperationalJob(service,'process_event_refunds',async()=>{throw new Error('private provider payload')})).rejects.toThrow();
  expect(update).toHaveBeenCalledWith(expect.objectContaining({status:'failed',result_counts:{}}));
  expect(JSON.stringify(update.mock.calls)).not.toContain('private provider payload');
 });
});
