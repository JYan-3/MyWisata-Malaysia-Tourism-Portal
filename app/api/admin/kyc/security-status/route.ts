import { requireKycReviewer } from '@/lib/kyc/reviewer-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk } from '@/lib/validation/schemas';

export async function GET() {
  const { response } = await requireKycReviewer();
  if (response) return response;
  const { data, error } = await createServiceClient().rpc('get_kyc_security_status');
  if (error || !data) return apiFail('SECURITY_STATUS_UNAVAILABLE', 'Unable to load KYC security status', 503);
  const result = apiOk(data);
  result.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return result;
}
