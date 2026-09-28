import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { eventPromotionResubmitSchema } from '@/lib/validation/vendor-schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { resubmitEventPromotion } from '@/lib/vendor/event-promotions';

interface Props { params: Promise<{ vendorId: string; id: string }> }

// Edit + resubmit — only valid while the entry is changes_requested. The RPC
// (called via the auth-bound client, not serviceDb — see event-promotions.ts)
// enforces that itself, so this route can't be used to edit anything else
// even if called directly.
export async function PATCH(request: Request, { params }: Props) {
  const { vendorId, id } = await params;
  const access = await authorizeVendor(vendorId);
  if (!access.ok) return access.response;

  const parsed = await parseBody(request, eventPromotionResubmitSchema);
  if (!parsed.ok) return parsed.response;

  const result = await resubmitEventPromotion(access.access.authDb, id, parsed.data);
  if (!result.ok) {
    if (result.code === 'not_found') return apiFail('NOT_FOUND', 'Event promotion not found', 404);
    if (result.code === 'not_editable') return apiFail('INVALID_STATE', 'Only an entry with requested changes can be resubmitted', 409);
    if (result.code === 'forbidden') return apiFail('FORBIDDEN', 'You do not have access to this event promotion', 403);
    return apiFail('DB_ERROR', 'Failed to resubmit event promotion', 500);
  }
  return apiOk({ ok: true });
}
