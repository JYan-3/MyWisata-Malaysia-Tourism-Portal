import { requireStaffAssurance } from '@/lib/auth/staff-assurance';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { WITHDRAWAL_REVIEW_STATUSES } from '@/lib/wallet/withdrawal-display';

export const dynamic = 'force-dynamic';

type CountResult = { count: number | null; error: { message: string } | null };

/** Count only queues the current staff member can actually review. */
export async function GET() {
  const authenticated = await createClient();
  const { data: { user }, error: authError } = await authenticated.auth.getUser();
  if (authError || !user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const assuranceResponse = await requireStaffAssurance(authenticated);
  if (assuranceResponse) return assuranceResponse;
  const [{ data: roleRows, error: roleError }, { data: staffAccess, error: accessError }] = await Promise.all([
    authenticated.from('user_roles').select('roles(name)').eq('user_id', user.id).is('vendor_id', null).is('outlet_id', null),
    authenticated.rpc('get_my_staff_access'),
  ]);
  if (roleError || accessError) return apiFail('AUTHORIZATION_UNAVAILABLE', 'Unable to verify staff access', 503);

  type RoleRow = { roles: { name: string } | { name: string }[] | null };
  const roleNames = ((roleRows ?? []) as RoleRow[]).map((row) => {
    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    return role?.name;
  });
  if (!roleNames.some((name) => ['admin', 'approver', 'staff', 'super_admin'].includes(name ?? ''))) {
    return apiFail('FORBIDDEN', 'Staff role required', 403);
  }
  if (!staffAccess || typeof staffAccess !== 'object' || Array.isArray(staffAccess)
    || !Array.isArray(staffAccess.permissionKeys)
    || !staffAccess.permissionKeys.every((key: unknown) => typeof key === 'string')) {
    return apiFail('AUTHORIZATION_UNAVAILABLE', 'Unable to verify staff permissions', 503);
  }
  const permissions = new Set<string>(staffAccess.permissionKeys);
  // An inactive profile has no effective permissions even if its coarse role remains.
  const canReviewSystemContent = permissions.size > 0 && roleNames.some((name) => name === 'admin' || name === 'super_admin');
  const canReviewVendors = permissions.has('admin.vendor.manage');
  const canReviewCatalogue = permissions.has('admin.catalogue.review');
  const canReviewKyc = permissions.has('admin.kyc.review');
  const canReviewWithdrawals = permissions.has('admin.withdrawal.approve');
  const canReviewRecommendations = permissions.has('admin.recommendation.review');
  const service = createServiceClient();
  const [vendors, outlets, products, vouchers, kyc, withdrawals, refunds, chatReports, recommendations] = await Promise.all([
    canReviewVendors ? service.from('vendors').select('id', { count: 'exact', head: true }).eq('status', 'pending') : null,
    canReviewCatalogue ? service.from('outlets').select('id', { count: 'exact', head: true }).eq('review_status', 'pending_review') : null,
    canReviewCatalogue ? service.from('products').select('id', { count: 'exact', head: true }).eq('review_status', 'pending_review') : null,
    canReviewCatalogue ? service.from('vouchers').select('id', { count: 'exact', head: true }).eq('review_status', 'pending_review').eq('vendor_review_status', 'approved') : null,
    canReviewKyc ? service.from('kyc_submissions').select('id', { count: 'exact', head: true }).in('status', ['pending', 'info_requested']) : null,
    canReviewWithdrawals ? service.from('withdrawal_requests').select('id', { count: 'exact', head: true }).in('status', [...WITHDRAWAL_REVIEW_STATUSES]) : null,
    canReviewSystemContent ? service.from('refunds').select('id', { count: 'exact', head: true }).eq('status', 'pending') : null,
    canReviewSystemContent ? service.from('chat_reports').select('id', { count: 'exact', head: true }).eq('status', 'open') : null,
    canReviewRecommendations ? service.from('vendor_recommendations').select('id', { count: 'exact', head: true }).eq('status', 'pending') : null,
  ]);

  const results: Array<CountResult | null> = [vendors, outlets, products, vouchers, kyc, withdrawals, refunds, chatReports, recommendations];
  const failed = results.find((result) => result?.error);
  if (failed?.error) {
    console.error('[admin-navigation-counts]', failed.error);
    return apiFail('DB_ERROR', 'Unable to load admin queue counts', 500);
  }

  return apiOk({
    ...(vendors ? { vendors: vendors.count ?? 0 } : {}),
    ...(outlets && products && vouchers ? { catalogue: (outlets.count ?? 0) + (products.count ?? 0) + (vouchers.count ?? 0) } : {}),
    ...(kyc ? { kyc: kyc.count ?? 0 } : {}),
    ...(withdrawals ? { withdrawals: withdrawals.count ?? 0 } : {}),
    ...(refunds ? { refunds: refunds.count ?? 0 } : {}),
    ...(chatReports ? { chatReports: chatReports.count ?? 0 } : {}),
    ...(recommendations ? { recommendations: recommendations.count ?? 0 } : {}),
  });
}
