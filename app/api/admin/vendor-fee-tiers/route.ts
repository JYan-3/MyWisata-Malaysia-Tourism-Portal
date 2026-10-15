// Vendor platform fee tiers + event fees.
// GET: anyone with admin.vendor.manage (read-only view). PUT: Super Admin only.
// Changes apply to orders paid from now on; settlements snapshot their fee.

import { createServiceClient } from '@/lib/supabase/service';
import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { isSuperAdmin } from '@/lib/affiliate/admin-guard';
import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { EVENT_FEE_SETTING_KEY, effectiveRank, feeSettingsSchema, loadFeeTiers } from '@/lib/vendor/fee-tiers';

type CampaignRow = { id: string; title: string; status: string; ends_at: string; platform_fee_per_item_sen: number | string | null };

export async function GET() {
  const { db, user, response } = await requireStaffPermission('admin.vendor.manage');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const service = createServiceClient();
  try {
    const [tiers, setting, campaigns, vendors, canEdit] = await Promise.all([
      loadFeeTiers(service),
      service.from('platform_settings').select('value').eq('key', EVENT_FEE_SETTING_KEY).maybeSingle(),
      service.from('promotion_campaigns').select('id,title,status,ends_at,platform_fee_per_item_sen')
        .neq('status', 'archived').gte('ends_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
        .order('starts_at', { ascending: true }).limit(200),
      service.from('vendors').select('fee_tier_rank,fee_tier_pinned').eq('status', 'approved'),
      isSuperAdmin(db, user.id),
    ]);
    if (campaigns.error || vendors.error) throw new Error('fee_settings_load_failed');
    const vendorCounts = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    for (const vendor of vendors.data ?? []) vendorCounts[effectiveRank(vendor)] = (vendorCounts[effectiveRank(vendor)] ?? 0) + 1;
    const eventDefault = Number(setting.data?.value);
    return apiOk({
      tiers,
      vendorCounts,
      eventDefaultPerItemSen: setting.data?.value && Number.isInteger(eventDefault) ? eventDefault : null,
      campaigns: ((campaigns.data ?? []) as CampaignRow[]).map((campaign) => ({
        id: campaign.id, title: campaign.title, status: campaign.status, endsAt: campaign.ends_at,
        perItemSen: campaign.platform_fee_per_item_sen === null ? null : Number(campaign.platform_fee_per_item_sen),
      })),
      canEdit,
    });
  } catch {
    return apiFail('FEE_SETTINGS_LOAD_FAILED', 'Unable to load platform fee settings', 500);
  }
}

export async function PUT(request: Request) {
  const { db, user, response } = await requireStaffPermission('admin.vendor.manage');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  if (!(await isSuperAdmin(db, user.id))) return apiFail('FORBIDDEN', 'Only Super Admin can change platform fees', 403);

  const parsed = await parseBody(request, feeSettingsSchema);
  if (!parsed.ok) return parsed.response;
  const { tiers, eventDefaultPerItemSen, campaignFees, reason } = parsed.data;

  const service = createServiceClient();
  const before = await loadFeeTiers(service).catch(() => null);
  const now = new Date().toISOString();
  const { error: tierError } = await service.from('vendor_fee_tiers').upsert(tiers.map((tier) => ({
    rank: tier.rank,
    name: tier.name,
    fee_type: tier.feeType,
    percent_rate: tier.feeType === 'percent' ? tier.percentRate : null,
    fixed_per_item_sen: tier.feeType === 'fixed' ? tier.fixedPerItemSen : null,
    min_sales_sen: tier.minSalesSen,
    updated_at: now,
    updated_by: user.id,
  })), { onConflict: 'rank' });
  if (tierError) return apiFail('FEE_TIERS_UPDATE_FAILED', 'Unable to save fee tiers', 500);

  const { error: settingError } = eventDefaultPerItemSen === null
    ? await service.from('platform_settings').delete().eq('key', EVENT_FEE_SETTING_KEY)
    : await service.from('platform_settings').upsert({ key: EVENT_FEE_SETTING_KEY, value: String(eventDefaultPerItemSen), updated_by: user.id }, { onConflict: 'key' });
  if (settingError) return apiFail('EVENT_FEE_UPDATE_FAILED', 'Unable to save the event fee default', 500);

  // promotion_campaigns is write-protected for the server role; fees go through an RPC.
  if (campaignFees.length > 0) {
    const { error } = await service.rpc('set_campaign_platform_fees', { p_fees: campaignFees });
    if (error) return apiFail('EVENT_FEE_UPDATE_FAILED', 'Unable to save an event fee', 500);
  }

  await service.from('audit_logs').insert({
    actor_id: user.id, action: 'vendor.platform_fees_updated', entity_type: 'vendor_fee_tiers', entity_id: user.id,
    before_data: { tiers: before }, after_data: { tiers, eventDefaultPerItemSen, campaignFees }, note: reason,
  });
  return apiOk({ saved: true });
}
