import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { apiFail } from '@/lib/validation/schemas';
import { staffPasskeyEnforcementEnabled } from './staff-passkey-config';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Input must come from auth.getClaims(), never an unverified decoded token. */
export function passwordSessionClaims(claims: Record<string, unknown>) {
  if (typeof claims.sub !== 'string' || !uuid.test(claims.sub)
    || typeof claims.session_id !== 'string' || !uuid.test(claims.session_id) || !Array.isArray(claims.amr)) return null;
  const methods = claims.amr.filter((entry): entry is { method: string; timestamp: number } =>
    Boolean(entry && typeof entry === 'object' && typeof entry.method === 'string' && Number.isFinite(entry.timestamp)));
  if (methods.length !== claims.amr.length) return null;
  const passwordAt = Math.max(-Infinity, ...methods.filter(entry => entry.method === 'password').map(entry => entry.timestamp));
  if (!Number.isFinite(passwordAt) || methods.some(entry => ['oauth', 'otp', 'recovery', 'invite', 'magiclink', 'passkey', 'sso/saml', 'anonymous'].includes(entry.method) && entry.timestamp >= passwordAt)) return null;
  return { userId: claims.sub, sessionId: claims.session_id };
}

export type StaffAssurance = { required: boolean; verified: boolean; passwordAuthenticated: boolean };

export async function staffAssurance(db: SupabaseClient): Promise<StaffAssurance> {
  const { data, error } = await db.rpc('staff_passkey_status');
  if (error || !data || typeof data.required !== 'boolean' || typeof data.verified !== 'boolean' || typeof data.passwordAuthenticated !== 'boolean') throw new Error('Staff verification unavailable');
  return data;
}

export async function requireStaffAssurance(db: SupabaseClient): Promise<Response | null> {
  // Existing callers still authenticate and check permissions; KYC also requires AAL2.
  if (!staffPasskeyEnforcementEnabled()) return null;
  try {
    const { data, error } = await db.auth.getClaims();
    if (error || !data?.claims) return apiFail('AUTHORIZATION_UNAVAILABLE', 'Unable to verify staff authentication', 503);
    const status = await staffAssurance(db);
    if (!status.required || !status.verified || !passwordSessionClaims(data.claims)) return apiFail('STAFF_PASSKEY_REQUIRED', 'Password and Passkey verification required', 403);
    return null;
  } catch { return apiFail('AUTHORIZATION_UNAVAILABLE', 'Unable to verify staff authentication', 503); }
}
