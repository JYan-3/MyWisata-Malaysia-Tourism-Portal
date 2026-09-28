import { apiFail, apiOk, databaseUuidSchema, parseBody } from '@/lib/validation/schemas';
import { campaignRegistrationSubmitSchema } from '@/lib/validation/vendor-schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { getMyCampaignRegistrations, submitCampaignRegistration } from '@/lib/vendor/campaign-registrations';

interface Props { params: Promise<{ vendorId: string }> }

const submitBodySchema = campaignRegistrationSubmitSchema.extend({ campaignId: databaseUuidSchema });

export async function GET(_request: Request, { params }: Props) {
  const { vendorId } = await params;
  const access = await authorizeVendor(vendorId);
  if (!access.ok) return access.response;

  const registrations = await getMyCampaignRegistrations(access.access.serviceDb, vendorId);
  return apiOk({ registrations });
}

export async function POST(request: Request, { params }: Props) {
  const { vendorId } = await params;
  const access = await authorizeVendor(vendorId);
  if (!access.ok) return access.response;

  const parsed = await parseBody(request, submitBodySchema);
  if (!parsed.ok) return parsed.response;

  const result = await submitCampaignRegistration(access.access.authDb, parsed.data.campaignId, vendorId, parsed.data);
  if (!result.ok) {
    if (result.code === 'forbidden') return apiFail('FORBIDDEN', 'You do not have access to this vendor', 403);
    if (result.code === 'campaign_not_open') return apiFail('INVALID_STATE', 'This event is not currently open for registration', 409);
    if (result.code === 'already_registered') return apiFail('ALREADY_REGISTERED', 'This vendor has already registered for this event', 409);
    if (result.code === 'invalid') return apiFail('VALIDATION_FAILED', 'The registration details are invalid', 422);
    return apiFail('DB_ERROR', 'Failed to submit the registration', 500);
  }
  return apiOk({ id: result.id }, { status: 201 });
}
