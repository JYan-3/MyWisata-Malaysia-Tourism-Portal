// Event locations — admin-side writes. Every write goes through the
// SECURITY DEFINER RPCs in 20260930190000_event_locations.sql.

import type { SupabaseClient } from "@supabase/supabase-js";
import { apiFail } from "@/lib/validation/schemas";
import type { CampaignLocationInput, CampaignLocationMutation } from "@/lib/promotion-campaigns/validation";

export function saveCampaignLocation(db: SupabaseClient, campaignId: string, locationId: string | null, input: CampaignLocationInput) {
  return db.rpc("save_promotion_campaign_location_protected", {
    p_campaign_id: campaignId, p_location_id: locationId, p_input: input,
    p_expected_updated_at: null, p_reason: null,
  });
}

export function protectedLocationParameters(campaignId: string, locationId: string, input: CampaignLocationMutation) {
  const { expectedUpdatedAt, reason, ...location } = input;
  return { p_campaign_id: campaignId, p_location_id: locationId, p_input: location,
    p_expected_updated_at: expectedUpdatedAt, p_reason: reason ?? null };
}

export function locationFailure(error: { message?: string }) {
  const message = (error.message ?? "").toLowerCase();
  const allocationErrors: Record<string, [string, string]> = {
    event_stall_conflict: ["STALL_CONFLICT", "This booth is already assigned at this location."],
    event_capacity_unconfirmed: ["CAPACITY_UNCONFIRMED", "Confirm the location capacity before approving vendors."],
    event_capacity_full: ["CAPACITY_FULL", "All confirmed booths at this location are occupied."],
    event_capacity_below_occupied: ["CAPACITY_BELOW_OCCUPIED", "Capacity cannot be lower than the confirmed booth count."],
    event_applications_closed: ["APPLICATIONS_CLOSED", "This location is no longer accepting new applications."],
    event_approvals_closed: ["APPROVALS_CLOSED", "The approval deadline has passed."],
    event_intake_schedule_invalid: ["INTAKE_SCHEDULE_INVALID", "Keep application and approval deadlines before setup and first opening."],
    event_setup_started: ["SETUP_STARTED", "Intake cannot be reopened after setup starts."],
  };
  for (const [marker, [code, description]] of Object.entries(allocationErrors)) {
    if (message.includes(marker)) return apiFail(code, description, 409);
  }
  if (message.includes("event_confirmed_stall_unique")) return apiFail("STALL_CONFLICT", "This booth is already assigned at this location.", 409);
  if (message.includes("stale")) return apiFail("CONFLICT", "This arrangement changed. Refresh it and try again.", 409);
  if (message.includes("location_change_has_reservations")) return apiFail("LOCATION_CHANGE_HAS_RESERVATIONS", "Existing reservations would be affected. Resolve them before changing this arrangement.", 409);
  if (message.includes("location_change_has_slots")) return apiFail("LOCATION_CHANGE_HAS_SLOTS", "Adjust incompatible pickup slots before changing this arrangement.", 409);
  if (message.includes("location_cancelled")) return apiFail("LOCATION_CANCELLED", "This location was cancelled", 409);
  if (message.includes("location_ended")) return apiFail("LOCATION_ENDED", "This location has finished operating", 409);
  if (message.includes("event_change_reason_required")) return apiFail("REASON_REQUIRED", "Enter a reason for the arrangement change", 422);
  if (message.includes("vendor_notice_recipient_unavailable")) return apiFail("NOTICE_RECIPIENT_UNAVAILABLE", "The vendor owner cannot receive this notice. Check their contact details before saving.", 409);
  if (message.includes("not_editable") || message.includes("campaign_not_open")) return apiFail("INVALID_STATE", "This arrangement is not open for changes", 409);
  if (message.includes("invalid_stall_number")) return apiFail("VALIDATION_FAILED", "Enter a valid stall number", 422);
  if (message.includes("permission_required")) return apiFail("FORBIDDEN", "You do not have permission to manage events", 403);
  if (message.includes("not_found")) return apiFail("NOT_FOUND", "Event or location was not found", 404);
  if (message.includes("outside_event")) return apiFail("OUTSIDE_EVENT", "Location dates must fall within the event's start and end dates", 422);
  if (message.includes("location_in_use")) return apiFail("LOCATION_IN_USE", "Vendors have registered at this location, so it can't be deleted", 409);
  if (message.includes("location_required")) return apiFail("LOCATION_REQUIRED", "A published event needs at least one location", 409);
  if (message.includes("location_invalid")) return apiFail("VALIDATION_FAILED", "The location details are invalid", 422);
  if (message.includes("invalid_transition")) return apiFail("INVALID_STATE", "Archived events can't be changed", 409);
  return apiFail("LOCATION_UNAVAILABLE", "Unable to save this location", 503);
}
