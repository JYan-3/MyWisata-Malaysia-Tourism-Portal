import { apiOk, parseBody } from '@/lib/validation/schemas';
import { pickupSlotSchema } from '@/lib/validation/vendor-schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { pickupSlotFailureResponse, saveEventPickupSlot } from '@/lib/vendor/campaign-registrations';

interface Props { params: Promise<{ vendorId: string }> }

/** POST: add or edit a pickup time for one of this vendor's event stalls. */
export async function POST(request: Request, { params }: Props) {
  const { vendorId } = await params;
  const access = await authorizeVendor(vendorId, undefined, { allowEventVendor: true });
  if (!access.ok) return access.response;

  const parsed = await parseBody(request, pickupSlotSchema);
  if (!parsed.ok) return parsed.response;

  const result = await saveEventPickupSlot(access.access.authDb, parsed.data);
  if (!result.ok) return pickupSlotFailureResponse(result.code);
  return apiOk({ ok: true });
}
