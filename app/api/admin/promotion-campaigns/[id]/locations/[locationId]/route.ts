import { requireStaffPermission } from "@/lib/staff-permissions/server";
import { apiFail, apiOk, databaseUuidSchema, parseBody } from "@/lib/validation/schemas";
import { campaignLocationSchema } from "@/lib/promotion-campaigns/validation";
import { locationFailure, saveCampaignLocation } from "@/lib/admin/campaign-locations";

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

  const parsed = await parseBody(request, campaignLocationSchema);
  if (!parsed.ok) return parsed.response;

  const { data, error } = await saveCampaignLocation(auth.db, id, locationId, parsed.data);
  if (error) return locationFailure(error);
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
