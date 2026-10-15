import { z } from 'zod';
import { requireStaffRoleManagementSuperAdmin } from '@/lib/staff-permissions/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { PLATFORM_OPERATION_KEYS } from '@/lib/platform/operations-settings';

export const dynamic = 'force-dynamic';

const settingKeys = Object.values(PLATFORM_OPERATION_KEYS);
const patchSchema = z.object({
  pauseNewOrders: z.boolean(),
  pauseCustomDelivery: z.boolean(),
  reason: z.string().trim().min(10).max(500),
}).strict();

export async function GET() {
  const { response } = await requireStaffRoleManagementSuperAdmin();
  if (response) return response;

  const service = createServiceClient();
  const { data, error } = await service.from('platform_settings')
    .select('key,value,updated_at,updated_by').in('key', settingKeys);
  if (error) return apiFail('SETTINGS_LOAD_FAILED', 'Unable to load system settings', 500);

  const rows = (data ?? []) as Array<{ key: string; value: string; updated_at?: string | null; updated_by?: string | null }>;
  if (settingKeys.some((key) => !rows.some((row) => row.key === key))) {
    return apiFail('SETTINGS_LOAD_FAILED', 'System settings are incomplete', 500);
  }
  const values = new Map(rows.map((row) => [row.key, row.value]));
  if (rows.some((row) => row.value !== 'true' && row.value !== 'false')) {
    return apiFail('SETTINGS_INVALID', 'System settings contain an invalid value', 500);
  }
  const latest = rows.filter((row) => row.updated_at).sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];
  let updatedByName: string | null = null;
  if (latest?.updated_by) {
    const { data: actor } = await service.from('users').select('full_name').eq('id', latest.updated_by).maybeSingle();
    updatedByName = actor?.full_name ?? null;
  }

  return apiOk({
    pauseNewOrders: values.get(PLATFORM_OPERATION_KEYS.pauseNewOrders) === 'true',
    pauseCustomDelivery: values.get(PLATFORM_OPERATION_KEYS.pauseCustomDelivery) === 'true',
    updatedAt: latest?.updated_at ?? null,
    updatedBy: updatedByName,
  });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireStaffRoleManagementSuperAdmin();
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const parsed = await parseBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const service = createServiceClient();
  const { data, error } = await service.rpc('set_platform_operations_settings', {
    p_pause_new_orders: parsed.data.pauseNewOrders,
    p_pause_custom_delivery: parsed.data.pauseCustomDelivery,
    p_actor_id: user.id,
    p_reason: parsed.data.reason,
  });
  if (error || typeof data !== 'string') {
    return apiFail('SETTINGS_UPDATE_FAILED', 'Unable to save system settings and audit record', 500);
  }
  const { data: actor } = await service.from('users').select('full_name').eq('id', user.id).maybeSingle();
  return apiOk({
    pauseNewOrders: parsed.data.pauseNewOrders,
    pauseCustomDelivery: parsed.data.pauseCustomDelivery,
    updatedAt: data,
    updatedBy: actor?.full_name ?? null,
  });
}
