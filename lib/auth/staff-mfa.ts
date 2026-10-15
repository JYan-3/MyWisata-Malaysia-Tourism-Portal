import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { apiFail } from '@/lib/validation/schemas';

/** Setup is only for the authenticated account's factors, never business access. */
export async function requireStaffMfaSetup() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return { response: apiFail('UNAUTHORIZED', 'Sign in required', 401) };
  // Own-row policies remain available before AAL2. The general permission RPC
  // intentionally denies AAL1, so using it here would prevent MFA enrollment.
  const [profile, roles] = await Promise.all([
    db.from('users').select('status').eq('id', user.id).maybeSingle(),
    db.from('user_roles').select('vendor_id,outlet_id,roles(name)').eq('user_id', user.id).is('vendor_id', null).is('outlet_id', null),
  ]);
  if (profile.error || roles.error) return { response: apiFail('AUTHORIZATION_UNAVAILABLE', 'Unable to verify staff identity', 503) };
  const allowed = profile.data?.status === 'active' && roles.data?.some(row => {
    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    return row.vendor_id === null && row.outlet_id === null && ['admin', 'approver', 'staff', 'super_admin'].includes(role?.name ?? '');
  });
  return { response: allowed ? null : apiFail('FORBIDDEN', 'Active global staff account required', 403) };
}

export async function staffMfaRequiredForSession(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims || data.claims.sub !== userId) throw new Error('Staff authentication unavailable');
  return data.claims.aal !== 'aal2';
}
