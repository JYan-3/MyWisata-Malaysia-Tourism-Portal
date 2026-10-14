import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEventReservationOperations } from '../reconciliation';
it('shows never-run, failed and stale jobs independently of mail configuration',async()=>{
 const service={rpc:vi.fn().mockResolvedValue({data:{cases:[],summary:{open:0},runs:[{jobKey:'process_event_refunds',status:'failed',finishedAt:'2026-01-01T00:00:00Z'}]},error:null})} as unknown as SupabaseClient;
 const result=await getEventReservationOperations(service);
 expect(result.jobs.map(j=>j.status)).toEqual(['never_run','failed']);
});
it('fails explicitly instead of displaying an empty healthy report on a DB failure',async()=>{
 const service={rpc:async()=>({data:null,error:{message:'private error'}})} as unknown as SupabaseClient;
 await expect(getEventReservationOperations(service)).rejects.toThrow('event_operations_unavailable');
});
