import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { passwordSessionClaims } from '@/lib/auth/staff-assurance';
import { apiFail } from '@/lib/validation/schemas';

export async function withdrawalSessionId(db: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await db.auth.getClaims();
    return error || !data?.claims ? null : passwordSessionClaims(data.claims)?.sessionId ?? null;
  } catch { return null; }
}

export function withdrawalProofFailure(message: string): Response | null {
  if (/staff_passkey_required|proof_required|actor_override_forbidden/.test(message)) return apiFail('WITHDRAWAL_PASSKEY_REQUIRED', 'Verify your Passkey again for this withdrawal', 403);
  if (/withdrawal_changed/.test(message)) return apiFail('WITHDRAWAL_CHANGED', 'Withdrawal details changed; reload and verify again', 409);
  return null;
}
