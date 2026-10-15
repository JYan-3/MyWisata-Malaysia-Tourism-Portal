import type { SupabaseClient } from '@supabase/supabase-js';
import { requireStaffAssurance } from '@/lib/auth/staff-assurance';

type RoleRow = { roles: { name: string } | { name: string }[] | null };

/** Recommendation reward operations are platform administration, not an
 * approver workflow. Keep this guard separate from Affiliate's approver guard. */
export async function isRecommendationRewardAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  if (await requireStaffAssurance(supabase)) return false;
  const { data, error } = await supabase
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', userId);
  if (error) return false;

  return ((data ?? []) as RoleRow[]).some((row) => {
    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    return role?.name === 'admin' || role?.name === 'super_admin';
  });
}
