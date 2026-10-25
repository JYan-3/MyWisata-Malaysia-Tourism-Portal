import type { SupabaseClient } from '@supabase/supabase-js';

export async function attributeRecommendationReward(service: SupabaseClient, orderId: string) {
  const { data: order, error: orderError } = await service.from('orders').select('id,status,total_amount').eq('id', orderId).maybeSingle();
  if (orderError) throw new Error('recommendation_reward_order_unavailable');
  if (!order || !['paid', 'completed', 'PAID', 'COMPLETED'].includes(order.status)) return { kind: 'skipped' as const };
  const { data: items, error: itemsError } = await service.from('order_items').select('vendor_id,line_total').eq('order_id', orderId);
  if (itemsError) throw new Error('recommendation_reward_items_unavailable');
  const vendorTotals = new Map<string, number>();
  for (const item of (items ?? []) as Array<{ vendor_id?: string | null; line_total?: number | string | null }>) {
    if (!item.vendor_id) continue;
    const lineTotal = Number(item.line_total);
    if (Number.isFinite(lineTotal) && lineTotal >= 0) {
      vendorTotals.set(item.vendor_id, (vendorTotals.get(item.vendor_id) ?? 0) + lineTotal);
    } else if (!vendorTotals.has(item.vendor_id)) {
      // Legacy order rows may not have a line total. Preserve a safe fallback
      // only for a single-vendor order; never allocate the full order total to
      // every vendor in a multi-vendor order.
      vendorTotals.set(item.vendor_id, 0);
    }
  }
  const vendorIds = [...vendorTotals.keys()];
  const { data: recommendationRule, error: ruleError } = await service
    .from('commission_rules')
    .select('ongoing_rate')
    .eq('rule_type', 'recommendation')
    .eq('tier_name', 'standard')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ruleError) throw new Error('recommendation_reward_rule_unavailable');
  const configuredRate = Number(recommendationRule?.ongoing_rate);
  const ongoingRate = Number.isFinite(configuredRate) && configuredRate > 0 && configuredRate <= 1
    ? configuredRate
    : 0.03;
  for (const vendorId of vendorIds) {
    // There can be historical conversion rows for one vendor. Select only the
    // currently active window, newest first; an unconstrained maybeSingle()
    // would fail as soon as the vendor is relinked after an old window closes.
    const { data: conversion, error: conversionError } = await service
      .from('recommendation_conversions')
      .select('id,recommendation_id,first_sale_awarded_at,attribution_ends_at,vendor_recommendations(recommender_id)')
      .eq('converted_vendor_id', vendorId)
      .or(`attribution_ends_at.is.null,attribution_ends_at.gt.${new Date().toISOString()}`)
      .order('converted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (conversionError) throw new Error('recommendation_reward_conversion_unavailable');
    if (!conversion) continue;
    if (conversion.attribution_ends_at && new Date(conversion.attribution_ends_at).getTime() <= Date.now()) continue;
    const recommenderId = (conversion.vendor_recommendations as { recommender_id?: string } | null)?.recommender_id;
    if (!recommenderId) continue;
    const firstSale = !conversion.first_sale_awarded_at;
    const vendorTotal = vendorTotals.get(vendorId) ?? 0;
    const amountSen = firstSale ? 5000 : Math.round(vendorTotal * 100 * ongoingRate);
    if (amountSen <= 0) continue;
    const { error } = await service.rpc('credit_pending_recommendation', { p_user_id: recommenderId, p_amount_sen: amountSen, p_commission_type: firstSale ? 'bonus' : 'ongoing', p_conversion_id: conversion.id, p_order_id: orderId, p_commission_rate: firstSale ? null : ongoingRate, p_note: firstSale ? 'Recommendation first-sale bonus' : 'Recommendation ongoing commission' });
    if (error) throw new Error('recommendation_reward_credit_unavailable');
  }
  // Re-read by order after all credit attempts. This recovers commissions
  // committed by an earlier partial attempt when the RPC correctly returns
  // null for an idempotent replay.
  const { data: savedCommissions, error: savedError } = await service
    .from('recommendation_commissions')
    .select('id,recommender_id,amount')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (savedError) throw new Error('recommendation_reward_records_unavailable');
  const savedRewards = ((savedCommissions ?? []) as Array<{ id: string; recommender_id: string; amount: number | string }>).map((row) => ({
    commissionId: String(row.id),
    recommenderId: String(row.recommender_id),
    amountSen: Math.round(Number(row.amount) * 100),
  }));
  if (savedRewards.length > 0) return { kind: 'created' as const, rewards: savedRewards };
  return { kind: 'skipped' as const };
}
