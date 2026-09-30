import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, databaseUuidSchema, parseBody } from '@/lib/validation/schemas';
import { closeRegistration, cancellationSchema } from '@/lib/events/cancellations';

interface Props { params: Promise<{ id: string }> }

/** POST: take a vendor off one event location; their reservations there are refunded. */
export async function POST(request: Request, { params }: Props) {
  const { db, response } = await requireStaffPermission('admin.promotion_campaign.manage');
  if (response) return response;
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) return apiFail('INVALID_ID', 'Registration id is invalid', 422);
  const parsed = await parseBody(request, cancellationSchema);
  if (!parsed.ok) return parsed.response;
  return closeRegistration(db, id, 'remove', parsed.data.reason);
}
