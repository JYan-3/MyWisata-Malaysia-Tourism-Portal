import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

export type PortalWorkload = 'kyc_upload' | 'recommendation_upload' | 'trip_ai';
const limits: Record<PortalWorkload, number> = { kyc_upload: 1, recommendation_upload: 2, trip_ai: 2 };
const active: Record<PortalWorkload, number> = { kyc_upload: 0, recommendation_upload: 0, trip_ai: 0 };
export class WorkloadUnavailableError extends Error {
  constructor(public code: 'busy' | 'unavailable') { super(`workload_${code}`); }
}

/** No waiting list. DB admission coordinates instances; the local guard also
 * protects a process during a failed/unknown release or an expired lease. */
export async function withPortalWorkload<T>(scope: PortalWorkload, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted || active[scope] >= limits[scope]) throw new WorkloadUnavailableError('busy');
  const db = createServiceClient();
  active[scope]++;
  const token = crypto.randomUUID();
  let claimed = false;
  try {
    const { data, error } = await db.rpc('claim_portal_workload', { p_scope: scope, p_token: token }).abortSignal(AbortSignal.timeout(5_000));
    if (error) throw new WorkloadUnavailableError('unavailable');
    if (data !== true) throw new WorkloadUnavailableError('busy');
    claimed = true;
    const deadline = AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]);
    deadline.throwIfAborted();
    return await work(deadline);
  } finally {
    // Never release while native work is still running: await the work above,
    // and give each native/provider operation its own shorter timeout.
    if (claimed) {
      try {
        const { error } = await db.rpc('release_portal_workload', { p_scope: scope, p_token: token }).abortSignal(AbortSignal.timeout(5_000));
        if (error) console.error('portal_workload_release_failed', { scope });
      } catch { console.error('portal_workload_release_failed', { scope }); }
    }
    active[scope]--;
  }
}
