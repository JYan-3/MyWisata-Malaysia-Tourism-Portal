import { requireStaffRoleManagementSuperAdmin } from "@/lib/staff-permissions/server";
import { staffEmployeePageSchema } from "@/lib/staff-permissions/employee-access";
import { apiFail, apiOk } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { db, response } = await requireStaffRoleManagementSuperAdmin();
  if (response) return response;
  const search = new URL(request.url).searchParams.get("search")?.trim() ?? "";
  if (!search || search.length > 100) return apiFail("VALIDATION_FAILED", "Enter an employee search of 1–100 characters", 422);
  const { data, error } = await db.rpc("list_staff_employees", { p_search: search, p_status: "active", p_page: 1, p_page_size: 25 });
  const parsed = staffEmployeePageSchema.safeParse(data);
  if (error || !parsed.success) return apiFail("STAFF_CANDIDATES_UNAVAILABLE", "Unable to load eligible staff", 503);
  return apiOk({ candidates: parsed.data.items.slice(0, 20).map(({ id, name, email, roles }) => ({ id, name, email, roles })) });
}
