import { requireKycReviewer } from '@/lib/kyc/reviewer-auth';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { privateKycOcrConfiguration } from '@/lib/kyc/ocr';
import { kycPrescreeningBudget } from '@/lib/kyc/prescreening';

export async function GET() {
  const { db, response } = await requireKycReviewer();
  if (response) return response;
  const { data, error } = await db.rpc('get_kyc_review_operations');
  if (error || !data) return apiFail('KYC_OPERATIONS_UNAVAILABLE', 'Unable to load KYC operations', 503);
  const result = apiOk({ ...data, privateOcrConfigured: Boolean(privateKycOcrConfiguration() && kycPrescreeningBudget()) });
  result.headers.set('Cache-Control', 'private, no-store');
  return result;
}
