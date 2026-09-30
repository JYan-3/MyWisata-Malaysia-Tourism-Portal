import { apiFail, databaseUuidSchema, parseBody } from '@/lib/validation/schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { closeRegistration, cancellationSchema } from '@/lib/events/cancellations';

interface Props { params: Promise<{ vendorId: string; id: string }> }

/** POST: the vendor pulls out of one event location; their reservations there are refunded. */
export async function POST(request: Request, { params }: Props) {
  const { vendorId, id } = await params;
  const access = await authorizeVendor(vendorId, undefined, { allowEventVendor: true });
  if (!access.ok) return access.response;
  if (!databaseUuidSchema.safeParse(id).success) return apiFail('INVALID_ID', 'Registration id is invalid', 422);
  const parsed = await parseBody(request, cancellationSchema);
  if (!parsed.ok) return parsed.response;
  return closeRegistration(access.access.authDb, id, 'withdraw', parsed.data.reason);
}
