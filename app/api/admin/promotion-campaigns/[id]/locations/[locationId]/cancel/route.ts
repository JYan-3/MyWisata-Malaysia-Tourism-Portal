import { requireStaffPermission } from "@/lib/staff-permissions/server";
import { apiFail, databaseUuidSchema, parseBody } from "@/lib/validation/schemas";
import { cancelLocation, cancellationSchema } from "@/lib/events/cancellations";

type Context = { params: Promise<{ id: string; locationId: string }> };

/** POST: cancel one event location; its stalls close and reservations are refunded. */
export async function POST(request: Request, context: Context) {
  const auth = await requireStaffPermission("admin.promotion_campaign.manage");
  if (auth.response) return auth.response;
  const { locationId } = await context.params;
  if (!databaseUuidSchema.safeParse(locationId).success) return apiFail("INVALID_ID", "Location id is invalid", 422);
  const parsed = await parseBody(request, cancellationSchema);
  if (!parsed.ok) return parsed.response;
  return cancelLocation(auth.db, locationId, parsed.data.reason);
}
