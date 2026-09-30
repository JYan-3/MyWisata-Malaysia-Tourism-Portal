import type { SupabaseClient } from '@supabase/supabase-js';
import { hashRecommendationInviteToken } from '@/lib/recommendations/invite-token';

export type VendorInviteErrorCode =
  | 'INVITE_INVALID'
  | 'INVITE_EXPIRED'
  | 'INVITE_CANCELLED'
  | 'INVITE_ALREADY_CLAIMED';

/** Shop invites come from a customer recommendation; event invites carry the business name admin entered. */
export type ResolvedVendorInvite =
  | { vendorKind: 'shop'; recommendationId: string; businessName: null; email: string }
  | { vendorKind: 'event'; recommendationId: null; businessName: string; email: string };

export type VendorInviteResolution =
  | { ok: true; invite: ResolvedVendorInvite }
  | { ok: false; error: { code: VendorInviteErrorCode; message: string; status: number } };

type VendorInviteRow = {
  recommendation_id: unknown;
  vendor_kind?: unknown;
  business_name?: unknown;
  email: unknown;
  status: unknown;
  expires_at: unknown;
};

function fail(code: VendorInviteErrorCode, message: string, status: number): VendorInviteResolution {
  return { ok: false, error: { code, message, status } };
}

export async function resolveActiveVendorInvite(
  service: SupabaseClient,
  token: string,
): Promise<VendorInviteResolution> {
  const { data, error } = await service
    .from('vendor_recommendation_invites')
    .select('recommendation_id,email,status,expires_at,vendor_kind,business_name')
    .eq('token_hash', hashRecommendationInviteToken(token))
    .maybeSingle();
  const invite = data as VendorInviteRow | null;
  const expiresAt = typeof invite?.expires_at === 'string' ? new Date(invite.expires_at).getTime() : NaN;
  const isEvent = invite?.vendor_kind === 'event';
  const hasSource = isEvent
    ? typeof invite?.business_name === 'string' && Boolean(invite.business_name.trim())
    : typeof invite?.recommendation_id === 'string' && Boolean(invite.recommendation_id.trim());

  if (
    error
    || !invite
    || !hasSource
    || typeof invite.email !== 'string'
    || !invite.email.trim()
    || typeof invite.status !== 'string'
    || !invite.status.trim()
    || !Number.isFinite(expiresAt)
  ) {
    return fail('INVITE_INVALID', 'This invitation link is invalid.', 404);
  }
  if (invite.status === 'cancelled') {
    return fail('INVITE_CANCELLED', 'This vendor invitation was cancelled.', 409);
  }
  if (invite.status !== 'invited') {
    return fail('INVITE_ALREADY_CLAIMED', 'This vendor invitation has already been claimed.', 409);
  }
  if (expiresAt <= Date.now()) {
    return fail('INVITE_EXPIRED', 'This vendor invitation has expired.', 409);
  }

  const email = invite.email.trim().toLowerCase();
  return {
    ok: true,
    invite: isEvent
      ? { vendorKind: 'event', recommendationId: null, businessName: String(invite.business_name).trim(), email }
      : { vendorKind: 'shop', recommendationId: String(invite.recommendation_id), businessName: null, email },
  };
}
