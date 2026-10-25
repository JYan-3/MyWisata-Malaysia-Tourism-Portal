import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { customerCapabilityFailure, resolveServerCustomerCapability } from '@/lib/auth/customer-capabilities.server';
import { getAffiliateEarningsPage } from '@/lib/affiliate/earnings-history';
import type { EarningsExportRange } from '@/lib/affiliate/earnings-range';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGES: EarningsExportRange[] = ['month', 'year', 'all'];

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const decision = await resolveServerCustomerCapability(user.id, 'affiliate.earn_commission');
  const failure = customerCapabilityFailure('affiliate.earn_commission', decision, 'Complete KYC verification to view Affiliate earnings');
  if (failure) return failure;

  const params = new URL(request.url).searchParams;
  const rawPageSize = Number(params.get('pageSize') ?? 10);
  const range = params.get('range') ?? 'all';
  const snapshotCutoff = params.get('snapshotCutoff') ?? undefined;
  const beforeCreatedAt = params.get('beforeCreatedAt');
  const beforeId = params.get('beforeId');
  if (![10, 25, 50].includes(rawPageSize)
    || !RANGES.includes(range as EarningsExportRange)
    || (snapshotCutoff !== undefined && (!Number.isFinite(Date.parse(snapshotCutoff)) || Date.parse(snapshotCutoff) > Date.now() + 60_000))
    || Boolean(beforeCreatedAt) !== Boolean(beforeId)
    || (beforeCreatedAt !== null && !Number.isFinite(Date.parse(beforeCreatedAt)))
    || (beforeId !== null && !UUID.test(beforeId))) {
    return apiFail('INVALID_QUERY', 'Invalid earnings history page query', 400);
  }

  try {
    const result = await getAffiliateEarningsPage(createServiceClient(), user.id, {
      range: range as EarningsExportRange,
      pageSize: rawPageSize as 10 | 25 | 50,
      snapshotCutoff,
      cursor: beforeCreatedAt && beforeId ? { createdAt: beforeCreatedAt, id: beforeId } : null,
    });
    return apiOk(result);
  } catch {
    return apiFail('EARNINGS_UNAVAILABLE', 'Affiliate earnings history is temporarily unavailable', 503);
  }
}
