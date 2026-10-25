// P4 — Member 4: admin affiliate oversight
// GET /api/admin/affiliate/stats — platform totals, top earners, suspicious
// activity, current commission rate, and the full attribution list. See
// CLAUDE.md Step 9. Gated on super_admin, checked server-side.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiOk, apiFail } from '@/lib/validation/schemas';
import { isSuperAdmin } from '@/lib/affiliate/admin-guard';
import { getAffiliateAdminStats } from '@/lib/affiliate/admin-stats';
import { getFinancialOperationsHealth } from '@/lib/operations/queue-health';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  if (!(await isSuperAdmin(supabase, user.id))) {
    return apiFail('FORBIDDEN', 'Only Super Admin can view affiliate oversight', 403);
  }

  // The service-only review/exposure reads are reachable only after the
  // Super Admin check above; keep their database ACL narrow.
  const service = createServiceClient();
  let stats;
  try {
    stats = await getAffiliateAdminStats(service);
  } catch {
    return apiFail('UNAVAILABLE', 'Affiliate statistics are temporarily unavailable', 503);
  }
  const healthResult = await getFinancialOperationsHealth()
    .then((data) => ({ data, unavailable: false as const }))
    .catch(() => ({ data: null, unavailable: true as const }));
  return apiOk({
    ...stats,
    financialOperationsHealth: healthResult.data ?? {
      computedAt: null, availability: 'unavailable', unavailableReasons: ['financial_operations_health_unavailable'],
    },
  });
}
