// P4 — Member 4: fraud flags list (CLAUDE-PHASE2.md Feature C)
// GET /api/admin/affiliate/fraud-flags — every flag ever raised, newest
// first, plus the "X self-referrals blocked, Y duplicate payouts prevented"
// counters. Gated on super_admin, checked server-side. Filtering
// by type/severity/status happens client-side, same pattern as the
// attributions table on this same admin page.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { z } from 'zod';
import { apiOk, apiFail } from '@/lib/validation/schemas';
import { isSuperAdmin } from '@/lib/affiliate/admin-guard';
import { getFraudFlagPage, getFraudCounters, getDisabledLinks, type FraudFlagType } from '@/lib/affiliate/fraud';

const fraudFlagTypes = ['self_referral','duplicate_attribution','expired_attribution','click_velocity','zero_conversion','visitor_clustering','click_cap_reached','vendor_ineligible','link_disabled_at_payout'] as const;
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  disabledPage: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().refine((value) => [10, 25, 50].includes(value)).default(10),
  type: z.union([z.literal('all'), z.enum(fraudFlagTypes)]).default('all'),
  severity: z.union([z.literal('all'), z.enum(['low','medium','high'])]).default('all'),
  status: z.union([z.literal('all'), z.enum(['open','reviewed','dismissed'])]).default('open'),
  search: z.string().max(200).default(''),
});

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  if (!(await isSuperAdmin(supabase, user.id))) {
    return apiFail('FORBIDDEN', 'Only Super Admin can view fraud flags', 403);
  }

  const parsed = listSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiFail('VALIDATION_FAILED', 'Invalid fraud flag filters', 422, parsed.error.flatten());

  const service = createServiceClient();
  try {
    const [flags, counters, disabledLinks] = await Promise.all([
      getFraudFlagPage(service, {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize as 10 | 25 | 50,
        flagType: parsed.data.type === 'all' ? null : parsed.data.type as FraudFlagType,
        severity: parsed.data.severity === 'all' ? null : parsed.data.severity,
        status: parsed.data.status === 'all' ? null : parsed.data.status,
        search: parsed.data.search.trim(),
      }),
      getFraudCounters(service),
      getDisabledLinks(service, parsed.data.disabledPage),
    ]);
    return apiOk({
      flags: flags.items,
      total: flags.total,
      page: flags.page,
      pageSize: flags.pageSize,
      counters,
      disabledLinks: disabledLinks.items,
      disabledLinksTotal: disabledLinks.total,
      disabledLinksPage: disabledLinks.page,
      disabledLinksPageSize: disabledLinks.pageSize,
    });
  } catch (error) {
    console.error('[admin-affiliate-fraud-flags]', error instanceof Error ? error.message : error);
    return apiFail('LIST_FAILED', 'Failed to load fraud flags', 500);
  }
}
