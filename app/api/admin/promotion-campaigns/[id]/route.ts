import { requireStaffPermission } from "@/lib/staff-permissions/server";
import { processRefundsAfterArchive } from "@/lib/events/cancellations";
import { apiFail, apiOk, parseBody } from "@/lib/validation/schemas";
import { campaignAdminPatchSchema } from "@/lib/promotion-campaigns/validation";
import { databaseUuidSchema } from "@/lib/validation/schemas";

function databaseFailure(error: { message?: string; code?: string } | null) {
  const message = (error?.message ?? "").toLowerCase();
  if (error?.code === "23505" || message.includes("promotion_campaigns_slug_key")) {
    return apiFail("SLUG_EXISTS", "That campaign address is already in use", 409);
  }
  if (message.includes("not_authorized") || message.includes("permission_denied")) {
    return apiFail("FORBIDDEN", "You do not have permission to manage promotion campaigns", 403);
  }
  if (message.includes("not_found")) return apiFail("NOT_FOUND", "Campaign was not found", 404);
  if (message.includes("stale") || message.includes("changed")) return apiFail("CONFLICT", "This campaign changed. Refresh it and try again.", 409);
  if (message.includes("poster_required")) {
    return apiFail("POSTER_REQUIRED", "Upload an event poster before submitting or approving this campaign", 409);
  }
  if (message.includes("location_required")) {
    return apiFail("LOCATION_REQUIRED", "Add at least one location before publishing this event", 409);
  }
  return apiFail("CAMPAIGN_UNAVAILABLE", "Unable to update this campaign", 503);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffPermission("admin.promotion_campaign.manage");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const idResult = databaseUuidSchema.safeParse(id);
  if (!idResult.success) return apiFail("INVALID_ID", "Campaign id is invalid", 422);

  const parsed = await parseBody(request, campaignAdminPatchSchema);
  if (!parsed.ok) return parsed.response;

  let result;
  if (parsed.data.action === "save_draft") {
    result = await auth.db.rpc("save_promotion_campaign_draft", {
        p_campaign_id: id,
        p_expected_updated_at: parsed.data.campaign.expectedUpdatedAt,
        p_title: parsed.data.campaign.title,
        p_slug: parsed.data.campaign.slug,
        p_summary: parsed.data.campaign.summary,
        p_description: parsed.data.campaign.description,
        p_starts_at: parsed.data.campaign.startsAt,
        p_ends_at: parsed.data.campaign.endsAt,
        p_poster_url: parsed.data.campaign.posterUrl,
        p_operating_hours: parsed.data.campaign.operatingHours,
      });
  } else {
    result = await auth.db.rpc("transition_promotion_campaign", {
        p_campaign_id: id,
        p_action: parsed.data.action,
        p_expected_updated_at: parsed.data.expectedUpdatedAt,
        p_note: parsed.data.note ?? null,
      });
  }

  const { data, error } = result;
  if (error) return databaseFailure(error);
  // Archiving cancels the event's reservations in SQL; refund the automatic ones now.
  if ("action" in parsed.data && parsed.data.action === "archive") await processRefundsAfterArchive();
  return apiOk(data);
}
