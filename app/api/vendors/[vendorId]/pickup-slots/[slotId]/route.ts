import { apiFail, apiOk, databaseUuidSchema } from '@/lib/validation/schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { deleteEventPickupSlot, pickupSlotFailureResponse } from '@/lib/vendor/campaign-registrations';

interface Props { params: Promise<{ vendorId: string; slotId: string }> }

/** DELETE: remove a pickup time nobody has reserved. */
export async function DELETE(_request: Request, { params }: Props) {
  const { vendorId, slotId } = await params;
  const access = await authorizeVendor(vendorId, undefined, { allowEventVendor: true });
  if (!access.ok) return access.response;
  if (!databaseUuidSchema.safeParse(slotId).success) return apiFail('INVALID_ID', 'Pickup time id is invalid', 422);

  const result = await deleteEventPickupSlot(access.access.authDb, slotId);
  if (!result.ok) return pickupSlotFailureResponse(result.code);
  return apiOk({ ok: true });
}
