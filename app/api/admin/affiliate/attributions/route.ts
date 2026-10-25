import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiOk, apiFail } from '@/lib/validation/schemas';
import { isSuperAdmin } from '@/lib/affiliate/admin-guard';
import { getAdminAffiliateAttributionPage } from '@/lib/affiliate/admin-stats';
import { z } from 'zod';

const cursorSchema = z.object({
  sortValue: z.string().max(400),
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();
const sortKeySchema = z.enum(['createdAt', 'userName', 'productName', 'status']);
const sortDirSchema = z.enum(['asc', 'desc']);

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  if (!(await isSuperAdmin(supabase, user.id))) {
    return apiFail('FORBIDDEN', 'Only Super Admin can view affiliate attributions', 403);
  }

  const params = new URL(request.url).searchParams;
  const statusParam = params.get('status') ?? 'all';
  const sortKey = sortKeySchema.safeParse(params.get('sortKey') ?? 'createdAt');
  const sortDir = sortDirSchema.safeParse(params.get('sortDir') ?? 'desc');
  const pageSize = Number(params.get('pageSize') ?? '10');
  const rawSearch = params.get('search')?.trim() ?? '';
  const snapshotCutoff = params.get('snapshotCutoff');
  const rawCursor = params.get('cursor');
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (rawCursor) {
    try {
      const parsed = cursorSchema.safeParse(JSON.parse(rawCursor));
      if (!parsed.success) return apiFail('VALIDATION_ERROR', 'Invalid attribution cursor', 422);
      cursor = parsed.data;
    } catch {
      return apiFail('VALIDATION_ERROR', 'Invalid attribution cursor', 422);
    }
  }

  if ((statusParam !== 'all' && !['pending', 'confirmed', 'reversed', 'rejected'].includes(statusParam))
    || !sortKey.success || !sortDir.success || ![10, 25, 50].includes(pageSize)
    || rawSearch.length > 100
    || (snapshotCutoff !== null && (!Number.isFinite(Date.parse(snapshotCutoff))
      || Date.parse(snapshotCutoff) > Date.now() + 60_000))) {
    return apiFail('VALIDATION_ERROR', 'Invalid attribution filters', 422);
  }

  try {
    const page = await getAdminAffiliateAttributionPage(createServiceClient(), {
      status: statusParam,
      search: rawSearch,
      sortKey: sortKey.data,
      sortDir: sortDir.data,
      pageSize: pageSize as 10 | 25 | 50,
      cursor,
      snapshotCutoff: snapshotCutoff ?? undefined,
    });
    return apiOk(page);
  } catch {
    return apiFail('UNAVAILABLE', 'Affiliate attributions are temporarily unavailable', 503);
  }
}
