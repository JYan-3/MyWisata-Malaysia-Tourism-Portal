import { requireAccessControlSuperAdmin } from "@/lib/entitlements/admin-guard";
import { getAdminUserLabel } from "@/lib/admin/identity";
import { createServiceClient } from "@/lib/supabase/service";
import { apiFail, apiOk } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { response } = await requireAccessControlSuperAdmin();
  if (response) return response;

  const search = new URL(request.url).searchParams.get("search")?.trim() ?? "";
  if (search.length < 2 || search.length > 100) {
    return apiFail("VALIDATION_FAILED", "Enter 2 to 100 characters to search users", 422);
  }

  // PostgREST's OR filter uses punctuation as syntax. Keep the term literal.
  const term = search.replace(/[%(),*]/g, " ").trim();
  if (term.length < 2) return apiOk({ candidates: [] });

  const { data, error } = await createServiceClient()
    .from("users")
    .select("id,full_name,display_name,email")
    .or(`full_name.ilike.%${term}%,display_name.ilike.%${term}%,email.ilike.%${term}%`)
    .order("email", { ascending: true })
    .limit(20);

  if (error) return apiFail("USER_SEARCH_UNAVAILABLE", "Unable to search users", 503);

  return apiOk({ candidates: (data ?? []).map((user) => ({
    id: user.id,
    name: getAdminUserLabel({
      fullName: user.full_name,
      displayName: user.display_name,
      email: user.email,
    }),
    email: user.email,
  })) });
}
