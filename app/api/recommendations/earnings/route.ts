// P4 — recommendation earnings for the current recommender.
// GET /api/recommendations/earnings — pending/cleared totals + a per-commission
// list, the recommendation-side mirror of GET /api/affiliate/stats. No
// capability gate: a user with no recommendations just gets zeros.

import { createClient } from '@/lib/supabase/server';
import { apiOk, apiFail } from '@/lib/validation/schemas';
import { getRecommendationEarnings } from '@/lib/recommendations/earnings';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const params = new URL(request.url).searchParams;
  const rawPageSize = params.get('pageSize') ?? '10';
  const pageSize = Number(rawPageSize);
  const recommendationId = params.get('recommendationId') ?? undefined;
  const snapshotCutoff = params.get('snapshotCutoff') ?? undefined;
  const beforeCreatedAt = params.get('beforeCreatedAt');
  const beforeId = params.get('beforeId');
  if (![10, 25, 50].includes(pageSize)
    || (recommendationId !== undefined && !uuidPattern.test(recommendationId))
    || (snapshotCutoff !== undefined && (!Number.isFinite(Date.parse(snapshotCutoff)) || Date.parse(snapshotCutoff) > Date.now() + 60_000))
    || Boolean(beforeCreatedAt) !== Boolean(beforeId)
    || (beforeCreatedAt !== null && !Number.isFinite(Date.parse(beforeCreatedAt)))
    || (beforeId !== null && !uuidPattern.test(beforeId))) {
    return apiFail('INVALID_QUERY', 'Invalid earnings page query', 400);
  }

  try {
    return apiOk(await getRecommendationEarnings(supabase, {
      recommendationId,
      snapshotCutoff,
      pageSize: pageSize as 10 | 25 | 50,
      cursor: beforeCreatedAt && beforeId ? { createdAt: beforeCreatedAt, id: beforeId } : null,
    }));
  } catch {
    return apiFail('EARNINGS_UNAVAILABLE', 'Earnings are temporarily unavailable', 503);
  }
}
