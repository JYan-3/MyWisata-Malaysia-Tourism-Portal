import { requireStaffPermission } from "@/lib/staff-permissions/server";
import { apiFail, apiOk, databaseUuidSchema, parseBody } from "@/lib/validation/schemas";
import { campaignLocationSchema } from "@/lib/promotion-campaigns/validation";
import { saveCampaignLocation, locationFailure } from "@/lib/admin/campaign-locations";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffPermission("admin.promotion_campaign.manage");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  if (!databaseUuidSchema.safeParse(id).success) return apiFail("INVALID_ID", "Campaign id is invalid", 422);

  const parsed = await parseBody(request, campaignLocationSchema);
  if (!parsed.ok) return parsed.response;

  const { data, error } = await saveCampaignLocation(auth.db, id, null, parsed.data);
  if (error) return locationFailure(error);
  return apiOk(data, { status: 201 });
}
