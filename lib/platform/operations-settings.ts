import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

export const PLATFORM_OPERATION_KEYS = {
  pauseNewOrders: 'operations.pause_new_orders',
  pauseCustomDelivery: 'email.pause_custom_delivery',
} as const;

export type PlatformOperationKey = typeof PLATFORM_OPERATION_KEYS[keyof typeof PLATFORM_OPERATION_KEYS];

export async function isPlatformOperationEnabled(key: PlatformOperationKey): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from('platform_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw new Error('platform_operation_settings_unavailable');
  if (!data) throw new Error('platform_operation_setting_missing');
  if (data.value !== 'true' && data.value !== 'false') throw new Error('platform_operation_setting_invalid');
  return data.value === 'true';
}

export async function ensureCustomEmailDeliveryEnabled(): Promise<void> {
  if (await isPlatformOperationEnabled(PLATFORM_OPERATION_KEYS.pauseCustomDelivery)) {
    throw new Error('custom_email_delivery_paused');
  }
}
