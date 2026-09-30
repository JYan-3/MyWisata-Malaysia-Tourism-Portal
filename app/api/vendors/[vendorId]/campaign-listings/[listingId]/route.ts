import { apiFail, apiOk, databaseUuidSchema, parseBody } from '@/lib/validation/schemas';
import { campaignListingUpdateSchema } from '@/lib/validation/vendor-schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { updateCampaignListing } from '@/lib/vendor/campaign-registrations';

interface Props { params: Promise<{ vendorId: string; listingId: string }> }

export async function PATCH(request: Request, { params }: Props) {
  const { vendorId, listingId } = await params;
  const access = await authorizeVendor(vendorId, undefined, { allowEventVendor: true });
  if (!access.ok) return access.response;
  if (!databaseUuidSchema.safeParse(listingId).success) return apiFail('INVALID_ID', 'Listing id is invalid', 422);

  const parsed = await parseBody(request, campaignListingUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await updateCampaignListing(access.access.authDb, listingId, parsed.data);
  if (!result.ok) {
    if (result.code === 'not_found') return apiFail('NOT_FOUND', 'Listing not found', 404);
    if (result.code === 'forbidden') return apiFail('FORBIDDEN', 'You do not have access to this listing', 403);
    if (result.code === 'not_editable') return apiFail('INVALID_STATE', 'This listing can no longer be changed', 409);
    if (result.code === 'invalid') return apiFail('VALIDATION_FAILED', 'The listing details are invalid', 422);
    return apiFail('DB_ERROR', 'Failed to update the listing', 500);
  }
  return apiOk({ ok: true });
}
