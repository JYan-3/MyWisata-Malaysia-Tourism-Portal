import type { SupabaseClient } from '@supabase/supabase-js';

type JobKey = 'expire_checkout_sessions' | 'process_event_refunds';

/** Record durable start before running a sweep; never persist provider payloads. */
export async function runEventOperationalJob<T extends Record<string, number>>(
  service: SupabaseClient, job: JobKey, execute: () => Promise<T>,
): Promise<T> {
  const { data, error } = await service.from('event_operational_job_runs')
    .insert({ job_key: job }).select('id').single();
  if (error || !data?.id) throw new Error('job_record_unavailable');
  try {
    const result = await execute();
    const { error: finishError } = await service.from('event_operational_job_runs').update({
      status: 'succeeded', finished_at: new Date().toISOString(), result_counts: result,
    }).eq('id', data.id);
    if (finishError) throw new Error('job_completion_record_unavailable');
    return result;
  } catch (error) {
    await service.from('event_operational_job_runs').update({
      status: 'failed', finished_at: new Date().toISOString(), result_counts: {},
    }).eq('id', data.id);
    throw error;
  }
}
