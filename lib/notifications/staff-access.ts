import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaffAssurance } from "@/lib/auth/staff-assurance";
import { apiFail } from "@/lib/validation/schemas";

const GLOBAL_STAFF_ROLES = new Set(["admin", "approver", "staff", "super_admin"]);

/** Require active staff work permissions before opening the personal staff inbox. */
export async function requireStaffNotificationAccess(db: SupabaseClient, userId: string): Promise<Response | null> {
  const assuranceResponse = await requireStaffAssurance(db);
  if (assuranceResponse) return assuranceResponse;

  const [profileResult, rolesResult] = await Promise.all([
    db.from("users").select("status").eq("id", userId).maybeSingle(),
    db.from("user_roles").select("roles!inner(name)").eq("user_id", userId).is("vendor_id", null).is("outlet_id", null),
  ]);
  if (profileResult.error || rolesResult.error) {
    return apiFail("AUTHORIZATION_UNAVAILABLE", "Unable to verify staff notification access", 503);
  }
  if (profileResult.data?.status !== "active") {
    return apiFail("FORBIDDEN", "Active staff access required", 403);
  }

  const hasGlobalStaffRole = (rolesResult.data ?? []).some((row) => {
    const roles = (row as { roles?: { name?: unknown } | Array<{ name?: unknown }> }).roles;
    const names = Array.isArray(roles) ? roles.map((role) => role.name) : [roles?.name];
    return names.some((name) => typeof name === "string" && GLOBAL_STAFF_ROLES.has(name));
  });
  if (!hasGlobalStaffRole) return apiFail("FORBIDDEN", "Staff access required", 403);

  // Invitation acceptance leaves the coarse staff role in place after the last
  // assignment is revoked. Use the same effective-permission source as routes.
  // Staff-scoped notifications currently contain withdrawal approval details.
  const { data: canReviewWithdrawals, error: accessError } = await db.rpc("has_staff_permission", {
    p_user_id: userId,
    p_permission_key: "admin.withdrawal.approve",
  });
  if (accessError) {
    return apiFail("AUTHORIZATION_UNAVAILABLE", "Unable to verify staff notification access", 503);
  }
  return canReviewWithdrawals === true ? null : apiFail("FORBIDDEN", "Withdrawal approval permission required", 403);
}
