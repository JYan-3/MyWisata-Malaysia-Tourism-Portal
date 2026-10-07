import { requireStaffPermission } from "@/lib/staff-permissions/server";
import { apiFail, apiOk, databaseUuidSchema, parseBody } from "@/lib/validation/schemas";
import { campaignLocationMutationSchema } from "@/lib/promotion-campaigns/validation";
import { locationFailure, protectedLocationParameters } from "@/lib/admin/campaign-locations";
import { processEmailOutbox } from "@/lib/email/outbox";

type Context = { params: Promise<{ id: string; locationId: string }> };

async function ids(context: Context) {
  const { id, locationId } = await context.params;
  const valid = databaseUuidSchema.safeParse(id).success && databaseUuidSchema.safeParse(locationId).success;
  return { id, locationId, valid };
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireStaffPermission("admin.promotion_campaign.manage");
  if (auth.response) return auth.response;

  const { id, locationId, valid } = await ids(context);
  if (!valid) return apiFail("INVALID_ID", "Location id is invalid", 422);

  const parsed = await parseBody(request, campaignLocationMutationSchema);
  if (!parsed.ok) return parsed.response;

  const { data, error } = await auth.db.rpc("save_promotion_campaign_location_protected", protectedLocationParameters(id, locationId, parsed.data));
  if (error) return locationFailure(error);
  if (data?.notificationQueued) {
    try { await processEmailOutbox(20); } catch { console.error("[event-notice] Delivery deferred to the outbox processor"); }
  }
  return apiOk(data);
}

export async function DELETE(_request: Request, context: Context) {
  const auth = await requireStaffPermission("admin.promotion_campaign.manage");
  if (auth.response) return auth.response;

  const { locationId, valid } = await ids(context);
  if (!valid) return apiFail("INVALID_ID", "Location id is invalid", 422);

  const { error } = await auth.db.rpc("delete_promotion_campaign_location", { p_location_id: locationId });
  if (error) return locationFailure(error);
  return apiOk({ ok: true });
}
