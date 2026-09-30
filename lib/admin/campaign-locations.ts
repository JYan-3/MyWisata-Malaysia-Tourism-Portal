// Event locations — admin-side writes. Every write goes through the
// SECURITY DEFINER RPCs in 20260930190000_event_locations.sql.

import type { SupabaseClient } from "@supabase/supabase-js";
import { apiFail } from "@/lib/validation/schemas";
import type { CampaignLocationInput } from "@/lib/promotion-campaigns/validation";

export function saveCampaignLocation(db: SupabaseClient, campaignId: string, locationId: string | null, input: CampaignLocationInput) {
  return db.rpc("save_promotion_campaign_location", {
    p_campaign_id: campaignId,
    p_location_id: locationId,
    p_name: input.name,
    p_address: input.address,
    p_lat: input.lat,
    p_lng: input.lng,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_opens_at: input.opensAt,
    p_closes_at: input.closesAt,
  });
}

export function locationFailure(error: { message?: string }) {
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("permission_required")) return apiFail("FORBIDDEN", "You do not have permission to manage events", 403);
  if (message.includes("not_found")) return apiFail("NOT_FOUND", "Event or location was not found", 404);
  if (message.includes("outside_event")) return apiFail("OUTSIDE_EVENT", "Location dates must fall within the event's start and end dates", 422);
  if (message.includes("location_in_use")) return apiFail("LOCATION_IN_USE", "Vendors have registered at this location, so it can't be deleted", 409);
  if (message.includes("location_required")) return apiFail("LOCATION_REQUIRED", "A published event needs at least one location", 409);
  if (message.includes("location_invalid")) return apiFail("VALIDATION_FAILED", "The location details are invalid", 422);
  if (message.includes("invalid_transition")) return apiFail("INVALID_STATE", "Archived events can't be changed", 409);
  return apiFail("LOCATION_UNAVAILABLE", "Unable to save this location", 503);
}
