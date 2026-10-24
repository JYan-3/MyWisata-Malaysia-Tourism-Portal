import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk, parseBody, walletSettingsPatchSchema } from '@/lib/validation/schemas';
import { moderateWalletAction } from '@/lib/wallet/moderation-guard';
import { walletReasonSchema } from '@/lib/validation/wallet-reason-schemas';

const KEYS = {
  clearanceDays: 'wallet.clearance_days',
  minAmountSen: 'withdrawal.min_amount_sen',
  dualApprovalThresholdSen: 'withdrawal.dual_approval_threshold_sen',
  escalationHours: 'withdrawal.escalation_hours',
  holdEscalationHours: 'withdrawal.hold_escalation_hours',
} as const;

type SettingName = keyof typeof KEYS;
const DEFAULTS: Record<SettingName, number> = {
  clearanceDays: 7, minAmountSen: 5000, dualApprovalThresholdSen: 50000,
  escalationHours: 48, holdEscalationHours: 168,
};

async function requireSuperAdmin() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { db, user: null, response: apiFail('UNAUTHORIZED', 'Sign in required', 401) };
  const { data, error } = await db.rpc('is_super_admin', { uid: user.id });
  if (error || !data) return { db, user, response: apiFail('FORBIDDEN', 'Super Admin access required', 403) };
  return { db, user, response: null };
}

function mapSettings(rows: Array<{ key: string; value: string; updated_at?: string | null; updated_by?: string | null }>) {
  const result = Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, value])) as Record<SettingName, number>;
  let latestUpdatedAt: string | null = null;
  let latestUpdatedBy: string | null = null;
  for (const row of rows) {
    const name = (Object.keys(KEYS) as SettingName[]).find((key) => KEYS[key] === row.key);
    if (!name) continue;
    const parsed = Number(row.value);
    if (Number.isFinite(parsed)) result[name] = parsed;
    if (row.updated_at && (!latestUpdatedAt || row.updated_at > latestUpdatedAt)) {
      latestUpdatedAt = row.updated_at;
      latestUpdatedBy = row.updated_by ?? null;
    }
  }
  return { ...result, updatedAt: latestUpdatedAt, updatedBy: latestUpdatedBy };
}

export async function GET() {
  const { response } = await requireSuperAdmin();
  if (response) return response;
  const service = createServiceClient();
  const { data, error } = await service.from('platform_settings').select('key,value,updated_at,updated_by').in('key', Object.values(KEYS));
  if (error) return apiFail('SETTINGS_LOAD_FAILED', 'Unable to load wallet settings', 500);
  return apiOk(mapSettings((data ?? []) as Array<{ key: string; value: string; updated_at?: string | null; updated_by?: string | null }>));
}

export async function PATCH(request: Request) {
  const { db, user, response } = await requireSuperAdmin();
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const parsed = await parseBody(request, walletSettingsPatchSchema);
  if (!parsed.ok) return parsed.response;
  const validated = walletReasonSchema.safeParse({ action: 'settings', reason: parsed.data.reason, reasonCategory: parsed.data.reasonCategory });
  if (!validated.success) return apiFail('VALIDATION_FAILED', validated.error.issues[0]?.message ?? 'Invalid settings reason', 422);
  const moderation = await moderateWalletAction({ actorId: user.id, action: 'settings', reasonCategory: validated.data.reasonCategory, reason: validated.data.reason });
  if (!moderation.ok) return apiFail(moderation.code, moderation.message, moderation.code === 'MODERATION_UNAVAILABLE' ? 503 : moderation.code === 'RATE_LIMITED' ? 429 : 422);

  const changes = (Object.keys(KEYS) as SettingName[]).filter((key) => parsed.data[key] !== undefined);
  const changed = Object.fromEntries(changes.map((key) => [KEYS[key], parsed.data[key]]));
  const { data: committed, error: settingsError } = await db.rpc('update_wallet_settings_with_audit', {
    p_settings: Object.fromEntries(changes.map((key) => [KEYS[key], parsed.data[key]])),
    p_reason: parsed.data.reason,
  });
  if (settingsError || !committed) return apiFail('SETTINGS_UPDATE_FAILED', 'Unable to update wallet settings and audit record', 500);
  let notificationSent = true;
  try {
    const { error: notificationError } = await createServiceClient().from('notifications').insert({
    user_id: user.id, type: 'wallet_settings_updated', title: 'Wallet settings updated',
    body: 'Your wallet governance settings change was recorded.', link: '/admin/wallet/settings',
    });
    if (notificationError) {
      notificationSent = false;
      console.error('Wallet settings notification failed after commit', notificationError);
    }
  } catch (error) {
    notificationSent = false;
    console.error('Wallet settings notification failed after commit', error);
  }
  return apiOk({ settings: changed, updatedAt: new Date().toISOString(), notificationSent });
}
