import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { campaignRegistrationResubmitSchema } from '@/lib/validation/vendor-schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { resubmitCampaignRegistration } from '@/lib/vendor/campaign-registrations';

interface Props { params: Promise<{ vendorId: string; id: string }> }

export async function PATCH(request: Request, { params }: Props) {
  const { vendorId, id } = await params;
  const access = await authorizeVendor(vendorId, undefined, { allowEventVendor: true });
  if (!access.ok) return access.response;

  const parsed = await parseBody(request, campaignRegistrationResubmitSchema);
  if (!parsed.ok) return parsed.response;

  const result = await resubmitCampaignRegistration(access.access.authDb, id, parsed.data);
  if (!result.ok) {
    if (result.code === 'not_found') return apiFail('NOT_FOUND', 'Registration not found', 404);
    if (result.code === 'not_editable') return apiFail('INVALID_STATE', 'This registration cannot be edited right now', 409);
    if (result.code === 'forbidden') return apiFail('FORBIDDEN', 'You do not have access to this registration', 403);
    if (result.code === 'invalid') return apiFail('VALIDATION_FAILED', 'The registration details are invalid', 422);
    return apiFail('DB_ERROR', 'Failed to update the registration', 500);
  }
  return apiOk({ ok: true });
}
