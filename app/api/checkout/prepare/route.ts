import { privateCheckoutJson } from '@/lib/checkout/guest-session';
import { resolveCheckoutSubject, resolveCheckoutContact } from '@/lib/checkout/subject';
import { parseBody, checkoutPrepareSchema } from '@/lib/validation/schemas';
import { buildCheckoutRequestHash, normalizeCheckoutRequest } from '@/lib/checkout/idempotency';
import { getCachedActivities } from '@/lib/cache/catalogue-cache';
import { cartTotals, unitPrice } from '@/backend/core/helpers';
import type { CartItem, Voucher } from '@/backend/core/types';
import { getCheckoutErrorCode, getCheckoutErrorMessage } from '@/lib/checkout/errors';
import { planCheckoutPayment, startCheckoutPayment } from '@/lib/checkout/start-payment';
import { stampReferralFromCookie } from '@/lib/affiliate/referral-cookie';

type Relation<T> = T | T[] | null;
type CartRow = {
  id: string;
  variant_id: string | null;
  slot_id: string | null;
  outlet_id: string | null;
  quantity: number;
  product_variants: Relation<{ id: string; product_id: string; name: string }>;
  booking_slots: Relation<{ id: string; product_id: string; outlet_id: string; starts_at: string; price_override: number | null }>;
};

function relation<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const context = await resolveCheckoutSubject(request);
  if (!context.ok) return context.response;
  const { db, subject } = context;
  const parsed = await parseBody(request, checkoutPrepareSchema, context.subject.kind === 'guest' ? { maxBytes: 32768 } : {});
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const contact = await resolveCheckoutContact(context, body.contact);
  if (!contact) return privateCheckoutJson({ error: { code: 'CONTACT_REQUIRED', message: 'Enter a valid contact email.' } }, { status: 422 });
  if (subject.kind === 'guest' && (body.voucherCode || body.claimId || ['wallet', 'wallet_split'].includes(body.paymentMethod))) return privateCheckoutJson({ error: { code: 'GUEST_ACCOUNT_FEATURE_DENIED', message: 'Sign in to use account benefits.' } }, { status: 403 });
  const user = { subject, contact };
  const normalized = normalizeCheckoutRequest(body);
  const planned = planCheckoutPayment(normalized.paymentMethod, normalized.paymentProvider ?? undefined, user);
  if (!planned.ok) return planned.response;
  const { walletSplit } = planned.plan;
  const requestHash = buildCheckoutRequestHash({ ...normalized, subject, contact });

  const { data: cart, error: cartError } = await db.from('carts').select('id').eq(subject.kind === 'account' ? 'user_id' : 'guest_subject_id', subject.kind === 'account' ? subject.userId : subject.guestSubjectId).maybeSingle();
  if (cartError) return privateCheckoutJson({ error: { code: 'CART_LOOKUP_FAILED', message: 'Unable to load cart.' } }, { status: 500 });
  if (!cart) return privateCheckoutJson({ error: 'Cart is empty' }, { status: 400 });

  const { data: rows, error: rowsError } = await db
    .from('cart_items')
    .select('id,variant_id,slot_id,outlet_id,quantity,product_variants(id,product_id,name),booking_slots(id,product_id,outlet_id,starts_at,price_override)')
    .eq('cart_id', cart.id)
    .order('created_at');
  if (rowsError) return privateCheckoutJson({ error: { code: 'CART_LOOKUP_FAILED', message: 'Unable to load cart items.' } }, { status: 500 });

  let activities;
  try {
    activities = await getCachedActivities();
  } catch {
    return privateCheckoutJson({ error: { code: 'PRODUCT_LOOKUP_FAILED', message: 'Unable to load catalogue.' } }, { status: 503 });
  }
  const activityMap = new Map(activities.map((activity) => [activity.id, activity]));
  const typedRows = (rows ?? []) as unknown as CartRow[];
  const selectedRows = typedRows.filter((row) => {
    const variant = relation(row.product_variants);
    const slot = relation(row.booking_slots);
    const productId = variant?.product_id ?? slot?.product_id;
    // Must stay byte-identical to cartItemKey() in components/providers/cart.tsx —
    // the client sends those keys and a mismatch silently selects nothing.
    const key = `${productId}|${row.variant_id ?? ''}|${row.slot_id ?? ''}|${row.outlet_id ?? ''}`;
    return !body.selectedKeys?.length || body.selectedKeys.includes(key);
  });
  if (!selectedRows.length) return privateCheckoutJson({ error: 'Select at least one cart item' }, { status: 400 });

  let voucher: Voucher | undefined;
  if (body.voucherCode) {
    const { data: voucherRow, error: voucherError } = await db.from('vouchers')
      .select('id,code,name,voucher_type,discount_value,min_spend,max_uses,uses_count,valid_until,vendor_id,outlet_id,product_id,buy_quantity,free_quantity')
      .ilike('code', body.voucherCode)
      .eq('is_active', true)
      .eq('review_status', 'approved')
      .in('redemption_mode', ['online', 'both'])
      .maybeSingle();
    if (voucherError) return privateCheckoutJson({ error: { code: 'VOUCHER_LOOKUP_FAILED', message: 'Unable to load voucher.' } }, { status: 500 });
    if (!voucherRow) return privateCheckoutJson({ error: 'Voucher is not available' }, { status: 422 });
    voucher = {
      id: voucherRow.id,
      code: voucherRow.code,
      name: voucherRow.name ?? undefined,
      type: voucherRow.voucher_type,
      value: Number(voucherRow.discount_value),
      minSpend: Number(voucherRow.min_spend ?? 0),
      usageCap: voucherRow.max_uses ?? Infinity,
      usageCount: Number(voucherRow.uses_count ?? 0),
      expiresAt: voucherRow.valid_until ?? '',
      vendorId: voucherRow.vendor_id ?? undefined,
      outletId: voucherRow.outlet_id ?? undefined,
      productId: voucherRow.product_id ?? undefined,
      buyQuantity: voucherRow.buy_quantity ?? undefined,
      freeQuantity: voucherRow.free_quantity ?? undefined,
    };
  }

  const productIds = [...new Set(selectedRows.flatMap((row) => {
    const variant = relation(row.product_variants);
    const slot = relation(row.booking_slots);
    const productId = variant?.product_id ?? slot?.product_id ?? '';
    return productId ? [productId] : [];
  }))];
  const { data: productRows, error: productRowsError } = await db.from('products')
    .select('id,outlet_id,vendor_id,name,cover_url,base_price,requires_booking,categories(slug)')
    .in('id', productIds);
  if (productRowsError) return privateCheckoutJson({
    error: {
      code: 'PRODUCT_LOOKUP_FAILED',
      message: 'We could not verify cart items right now. Please try again shortly.',
    },
  }, { status: 503 });
  const productMap = new Map((productRows ?? []).map((row) => [row.id, row]));

  const sharedOutletProductIds = [...new Set(selectedRows.flatMap((row) => {
    const variant = relation(row.product_variants);
    const slot = relation(row.booking_slots);
    const productId = variant?.product_id ?? slot?.product_id ?? '';
    const product = productMap.get(productId);
    return product?.outlet_id === null && row.outlet_id ? [productId] : [];
  }))];
  const sharedOutletIds = [...new Set(selectedRows.flatMap((row) => {
    const variant = relation(row.product_variants);
    const slot = relation(row.booking_slots);
    const productId = variant?.product_id ?? slot?.product_id ?? '';
    return sharedOutletProductIds.includes(productId) && row.outlet_id ? [row.outlet_id] : [];
  }))];
  let outletOffers: { product_id: string; outlet_id: string; price: number | string }[] = [];
  if (sharedOutletProductIds.length > 0 && sharedOutletIds.length > 0) {
    const { data, error } = await db.from('outlet_offers')
      .select('product_id,outlet_id,price')
      .in('product_id', sharedOutletProductIds)
      .in('outlet_id', sharedOutletIds)
      .eq('status', 'active');
    if (error) return privateCheckoutJson({
      error: {
        code: 'PRODUCT_LOOKUP_FAILED',
        message: 'We could not verify cart items right now. Please try again shortly.',
      },
    }, { status: 503 });
    outletOffers = data ?? [];
  }
  const outletOfferMap = new Map(outletOffers.map((offer) => [`${offer.product_id}|${offer.outlet_id}`, Number(offer.price)]));

  const candidateLines = selectedRows.map((row) => {
    const variant = relation(row.product_variants);
    const slot = relation(row.booking_slots);
    const productId = variant?.product_id ?? slot?.product_id ?? '';
    const activity = activityMap.get(productId);
    const product = productMap.get(productId);
    if (
      !activity
      || !product
      || (!variant && (!product.requires_booking || row.variant_id !== null))
      || (product.requires_booking && !slot)
    ) return null;
    const isSharedProduct = product.outlet_id === null;
    if (!isSharedProduct && product.outlet_id !== row.outlet_id) return null;
    const offerPrice = isSharedProduct && row.outlet_id
      ? outletOfferMap.get(`${productId}|${row.outlet_id}`)
      : undefined;
    if (isSharedProduct && row.outlet_id && offerPrice === undefined) return null;
    const basePrice = offerPrice ?? Number(product.base_price);
    if (!Number.isFinite(basePrice) || basePrice < 0) return null;
    const linePrice = slot?.price_override !== null && slot?.price_override !== undefined
      ? Number(slot.price_override)
      : unitPrice({ ...activity, price: basePrice }, variant?.id ?? '', row.quantity, new Date(), productIds);
    if (!Number.isFinite(linePrice) || linePrice < 0) return null;
    return {
      cartItem: {
        activityId: productId,
        variantId: row.variant_id ?? '',
        slotId: row.slot_id ?? undefined,
        qty: row.quantity,
        outletId: row.outlet_id ?? undefined,
        // cartTotals must use the same outlet-resolved price sent to the DB RPC.
        priceOverride: linePrice,
      } satisfies CartItem,
      line: {
        cart_item_id: row.id,
        product_id: productId,
        variant_id: variant?.id ?? null,
        slot_id: row.slot_id,
        vendor_id: product.vendor_id,
        outlet_id: row.outlet_id,
        product_name: product.name,
        image_url: product.cover_url,
        variant_name: variant?.name ?? null,
        slot_starts_at: slot?.starts_at ?? null,
        unit_price: linePrice,
        quantity: row.quantity,
        line_total: Number((linePrice * row.quantity).toFixed(2)),
        requires_booking: product.requires_booking,
      },
    };
  });
  if (candidateLines.some((line) => line === null)) return privateCheckoutJson({
    error: {
      code: 'CART_ITEM_UNAVAILABLE',
      message: 'One or more cart items are no longer available. Refresh your cart and try again.',
    },
  }, { status: 409 });
  const pricedLines = candidateLines.filter((line) => line !== null);
  const lines = pricedLines.map(({ line }) => line);
  const totals = cartTotals(pricedLines.map(({ cartItem }) => cartItem), activities, voucher);
  if (voucher && totals.voucherError) return privateCheckoutJson({ error: totals.voucherError }, { status: 422 });

  const selectedFoodOutlets = [...new Set(lines.flatMap((line) => {
    const product = productMap.get(line.product_id) as { categories?: { slug?: string } | { slug?: string }[] | null } | undefined;
    const category = Array.isArray(product?.categories) ? product.categories[0] : product?.categories;
    return category?.slug === 'food' ? [line.outlet_id] : [];
  }))];
  const selectedModes = normalized.foodServiceModes;
  if (selectedModes.length !== selectedFoodOutlets.length || new Set(selectedModes.map((selection) => selection.outletId)).size !== selectedModes.length) {
    return privateCheckoutJson({
      data: null,
      error: { code: 'FOOD_SERVICE_MODE_REQUIRED', message: 'Choose dine-in or takeaway for every food outlet in checkout.' },
    }, { status: 422 });
  }
  if (selectedFoodOutlets.length > 0) {
    const { data: foodOutlets, error: outletModesError } = await db.from('outlets')
      .select('id,food_service_modes')
      .in('id', selectedFoodOutlets);
    if (outletModesError) return privateCheckoutJson({ error: 'Food service options could not be verified. Please try again.' }, { status: 503 });
    const allowedModes = new Map((foodOutlets ?? []).map((outlet: { id: string; food_service_modes: string[] }) => [outlet.id, outlet.food_service_modes]));
    if (selectedModes.some((selection) => !selectedFoodOutlets.includes(selection.outletId) || !allowedModes.get(selection.outletId)?.includes(selection.mode))) {
      return privateCheckoutJson({
        data: null,
        error: { code: 'FOOD_SERVICE_MODE_UNAVAILABLE', message: 'The selected food service option is unavailable at this outlet. Refresh checkout and try again.' },
      }, { status: 422 });
    }
  }

  const checkoutArgs = {
    p_cart_id: cart.id,
    p_selected_item_ids: selectedRows.map((row) => row.id),
    p_idempotency_key: body.idempotencyKey,
    p_request_hash: requestHash,
    p_payment_method: walletSplit ? 'stripe_card' : normalized.paymentMethod,
    p_subtotal: totals.subtotal,
    p_discount: totals.discount,
    p_total: totals.total,
    p_voucher_code: normalized.voucherCode,
    p_lines: lines,
    ...(normalized.claimId ? { p_claim_id: normalized.claimId } : {}),
  };
  const checkoutFunction = selectedFoodOutlets.length > 0 ? 'prepare_checkout_with_food_service_modes' : 'prepare_checkout';
  const rpcArgs = selectedFoodOutlets.length > 0
    ? { ...checkoutArgs, p_claim_id: normalized.claimId, p_food_service_modes: selectedModes.map(({ outletId, mode }) => ({ outlet_id: outletId, mode })) }
    : checkoutArgs;
  const { data: prepared, error: prepareError } = await db.rpc(subject.kind === 'guest' ? `guest_${checkoutFunction}` : `account_${checkoutFunction}`, { ...rpcArgs, ...(subject.kind === 'guest' ? { p_guest_subject_id: subject.guestSubjectId, p_contact: contact } : { p_contact: contact }) });
  if (prepareError) {
    const rawMessage = prepareError.message ?? "checkout_failed";
    const code = getCheckoutErrorCode(rawMessage);
    return privateCheckoutJson(
      { error: { code, message: getCheckoutErrorMessage(code) } },
      { status: 409 },
    );
  }

  // Before payment starts: free/wallet orders are paid inside startCheckoutPayment,
  // and redirect payments leave the site, so the referral must be saved now.
  await stampReferralFromCookie((prepared as { order_id?: string } | null)?.order_id);
  return startCheckoutPayment({ db, user, request, prepared, total: totals.total, plan: planned.plan });
}
