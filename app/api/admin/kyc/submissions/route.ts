import { requireKycReviewer } from '@/lib/kyc/reviewer-auth';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { kycQueueQuerySchema } from '@/lib/kyc/operations';

export async function GET(request: Request) {
  const { db, response } = await requireKycReviewer();
  if (response) return response;
  const parsed = kycQueueQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiFail('VALIDATION_FAILED', 'Invalid KYC queue filters', 422);
  const { page, pageSize, status, assignment, search } = parsed.data;
  const { data, error } = await db.rpc('get_kyc_review_queue', {
    p_page: page, p_page_size: pageSize, p_status: status, p_assignment: assignment, p_search: search,
  });
  if (error || !data || typeof data !== 'object') return apiFail('KYC_QUEUE_UNAVAILABLE', 'Unable to load KYC review queue', 503);
  const result = apiOk(data);
  result.headers.set('Cache-Control', 'private, no-store');
  return result;
}
