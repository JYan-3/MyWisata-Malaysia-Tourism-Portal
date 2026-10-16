import 'server-only';

import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail } from '@/lib/validation/schemas';

/** Verify the session's signed assurance claim before any privileged KYC read. */
export async function requireKycReviewer() {
  const base = await requireStaffPermission('admin.kyc.review');
  if (base.response) return base;
  try {
    const { data, error } = await base.db.auth.getClaims();
    if (error || !data?.claims || data.claims.sub !== base.user.id) {
      return { ...base, response: apiFail('AUTHORIZATION_UNAVAILABLE', 'Unable to verify reviewer authentication', 503) };
    }
    if (data.claims.aal !== 'aal2') {
      return { ...base, response: apiFail('KYC_MFA_REQUIRED', 'Authenticator verification required for KYC review', 403) };
    }
    return base;
  } catch {
    return { ...base, response: apiFail('AUTHORIZATION_UNAVAILABLE', 'Unable to verify reviewer authentication', 503) };
  }
}
