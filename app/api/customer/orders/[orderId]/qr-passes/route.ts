import { guestPrivateResponse } from '@/lib/checkout/guest-session';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeOrder } from '@/lib/checkout/order-access';
import { apiFail } from "@/lib/validation/schemas";
import { signTicketPassToken } from "@/lib/tickets/tokens";
import { signFoodFulfilmentToken } from "@/lib/food/food-fulfilment-token";
import { signEventPickupToken } from "@/lib/events/event-pickup-token";

interface Props { params: Promise<{ orderId: string }> }

const PAID_ORDER_STATES = new Set(["paid", "completed"]);

type TicketPassProjection = {
  id: string;
  policy: "single_entry" | "multi_entry" | "group_entry";
  entry_limit: number;
  entries_used: number;
  status: string;
  valid_from: string | null;
  valid_until: string | null;
};

function isMissingFoodFulfilmentColumn(error: { code?: string; message?: string } | null) {
  return error?.code === "42703" && (
    error.message?.includes("order_items.food_fulfilment_mode") === true
    || error.message?.includes("order_items.food_qr_scanned_at") === true
  );
}

export async function GET(request: Request, { params }: Props) {
  const { orderId } = await params;
  const access = await authorizeOrder(request, orderId);
  if (!access) return apiFail("NOT_FOUND", "Order not found", 404);
  const db = access.db;
  const order = access.order;

  if (!order) return apiFail("NOT_FOUND", "Order not found", 404);
  if (!PAID_ORDER_STATES.has(String(order.status).toLowerCase())) {
    return apiFail("ORDER_NOT_PAID", "Pass codes become available after payment is complete", 409);
  }

  const { data: bookings, error: bookingError } = await db
    .from("bookings")
    .select("id,order_items!inner(outlet_id,vendor_id,outlets(id,name,vendor_id,vendors(id,name))),ticket_passes(id,policy,entry_limit,entries_used,status,valid_from,valid_until)")
    .eq("order_items.order_id", orderId);
  if (bookingError) return apiFail("DB_ERROR", bookingError.message, 500);

  let missingTicketIdentity = false;
  const tickets = (bookings ?? []).flatMap((booking: {
    id: string;
    order_items: { outlet_id: string; vendor_id: string; outlets: { id: string; name: string; vendor_id: string; vendors: { id: string; name: string } | { id: string; name: string }[] | null } | { id: string; name: string; vendor_id: string; vendors: { id: string; name: string } | { id: string; name: string }[] | null }[] | null } | { outlet_id: string; vendor_id: string; outlets: { id: string; name: string; vendor_id: string; vendors: { id: string; name: string } | { id: string; name: string }[] | null } | { id: string; name: string; vendor_id: string; vendors: { id: string; name: string } | { id: string; name: string }[] | null }[] | null }[] | null;
    ticket_passes: TicketPassProjection | TicketPassProjection[] | null;
  }) => {
    const item = Array.isArray(booking.order_items) ? booking.order_items[0] : booking.order_items;
    const pass = Array.isArray(booking.ticket_passes) ? booking.ticket_passes[0] : booking.ticket_passes;
    if (!item?.outlet_id || !pass?.id) return [];
    const outlet = Array.isArray(item.outlets) ? item.outlets[0] : item.outlets;
    const vendor = Array.isArray(outlet?.vendors) ? outlet.vendors[0] : outlet?.vendors;
    if (!outlet?.name || !vendor?.name || outlet.id !== item.outlet_id || outlet.vendor_id !== item.vendor_id || vendor.id !== item.vendor_id) {
      missingTicketIdentity = true;
      return [];
    }
    const passToken = signTicketPassToken({
      passId: pass.id,
      bookingId: booking.id,
      outletId: item.outlet_id,
      policy: pass.policy,
      entryLimit: pass.entry_limit,
      issuedAt: Date.now(),
      ...(pass.valid_until ? { exp: Math.floor(new Date(pass.valid_until).getTime() / 1000) } : {}),
    });
    return [{
      bookingId: booking.id,
      outletName: outlet.name,
      vendorName: vendor.name,
      passToken,
      policy: pass.policy,
      entryLimit: pass.entry_limit,
      entriesUsed: pass.entries_used,
      status: pass.status,
      validFrom: pass.valid_from,
      validUntil: pass.valid_until,
    }];
  });
  if (missingTicketIdentity) return apiFail("MERCHANT_IDENTITY_UNAVAILABLE", "Ticket merchant identity is unavailable", 409);

  const { data: orderItems, error: itemError } = await db
    .from("order_items")
    .select("id,vendor_id,outlet_id,product_name,variant_name,quantity,food_fulfilment_mode,food_qr_scanned_at,fulfil_status,products(categories(slug)),outlets(id,name,vendor_id,vendors(id,name))")
    .eq("order_id", orderId);
  if (isMissingFoodFulfilmentColumn(itemError)) {
    // Ticket QR passes are independent of the optional food fulfilment schema.
    // Keep them available while an environment is waiting for that migration.
    return guestPrivateResponse({ tickets, foodOrders: [], eventPickups: await loadEventPickups(db, orderId) });
  }
  if (itemError) return apiFail("DB_ERROR", itemError.message, 500);

  const foodGroups = new Map<string, {
    outletId: string;
    outletName: string;
    vendorName: string;
    mode: "dine_in" | "takeaway";
    allFulfilled: boolean;
    allScanned: boolean;
    items: { name: string; variant: string | null; quantity: number }[];
  }>();
  for (const row of (orderItems ?? []) as Array<{
    outlet_id: string | null;
    product_name: string;
    variant_name: string | null;
    quantity: number;
    food_fulfilment_mode: "dine_in" | "takeaway" | null;
    food_qr_scanned_at: string | null;
    fulfil_status: string;
    products: { categories: { slug: string } | { slug: string }[] | null } | { categories: { slug: string } | { slug: string }[] | null }[] | null;
    vendor_id: string;
    outlets: { id: string; name: string; vendor_id: string; vendors: { id: string; name: string } | { id: string; name: string }[] | null } | { id: string; name: string; vendor_id: string; vendors: { id: string; name: string } | { id: string; name: string }[] | null }[] | null;
  }>) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const category = Array.isArray(product?.categories) ? product.categories[0] : product?.categories;
    if (category?.slug !== "food" || !row.outlet_id || !row.food_fulfilment_mode || row.fulfil_status === "cancelled") continue;
    const outlet = Array.isArray(row.outlets) ? row.outlets[0] : row.outlets;
    const vendor = Array.isArray(outlet?.vendors) ? outlet.vendors[0] : outlet?.vendors;
    if (!outlet?.name || !vendor?.name || outlet.id !== row.outlet_id || outlet.vendor_id !== row.vendor_id || vendor.id !== row.vendor_id) return apiFail("MERCHANT_IDENTITY_UNAVAILABLE", "Food outlet merchant identity is unavailable", 409);
    let group = foodGroups.get(row.outlet_id);
    if (!group) {
      group = { outletId: row.outlet_id, outletName: outlet.name, vendorName: vendor.name, mode: row.food_fulfilment_mode, allFulfilled: true, allScanned: true, items: [] };
      foodGroups.set(row.outlet_id, group);
    }
    if (group.mode !== row.food_fulfilment_mode) return apiFail("FOOD_ORDER_INCONSISTENT", "Food items at one outlet have inconsistent service modes", 409);
    if (row.fulfil_status !== "fulfilled") group.allFulfilled = false;
    if (!row.food_qr_scanned_at) group.allScanned = false;
    group.items.push({ name: row.product_name, variant: row.variant_name, quantity: row.quantity });
  }

  const foodOrders = [...foodGroups.values()].map(({ allFulfilled, allScanned, ...group }) => ({
    ...group,
    status: allFulfilled ? "fulfilled" : group.mode === "dine_in" && allScanned ? "checked_in" : "pending",
    foodToken: signFoodFulfilmentToken({ orderId, outletId: group.outletId, issuedAt: Date.now() }),
  }));
  return guestPrivateResponse({ tickets, foodOrders, eventPickups: await loadEventPickups(db, orderId) });
}

type EventPickupRow = {
  vendor_id: string;
  event_location_id: string;
  pickup_date: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  fulfil_status: string;
  vendors: { name: string } | { name: string }[] | null;
};

/** One pickup code per vendor, event location and pickup date; valid only on that date. */
async function loadEventPickups(db: SupabaseClient, orderId: string) {
  const { data, error } = await db
    .from("order_items")
    .select("vendor_id,event_location_id,pickup_date,product_name,variant_name,quantity,fulfil_status,vendors(name)")
    .eq("order_id", orderId);
  if (error) return [];
  const groups = new Map<string, {
    vendorName: string;
    pickupDate: string;
    pickupLabels: string[];
    allFulfilled: boolean;
    items: { name: string; quantity: number }[];
    token: string;
  }>();
  for (const row of (data ?? []) as EventPickupRow[]) {
    // Only event reservations carry a location and pickup date.
    if (!row.event_location_id || !row.pickup_date || row.fulfil_status === "cancelled") continue;
    const key = `${row.vendor_id}:${row.event_location_id}:${row.pickup_date}`;
    let group = groups.get(key);
    if (!group) {
      const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors;
      group = {
        vendorName: vendor?.name ?? "",
        pickupDate: row.pickup_date,
        pickupLabels: [],
        allFulfilled: true,
        items: [],
        token: signEventPickupToken({ orderId, vendorId: row.vendor_id, locationId: row.event_location_id, pickupDate: row.pickup_date, issuedAt: Date.now() }),
      };
      groups.set(key, group);
    }
    if (row.variant_name && !group.pickupLabels.includes(row.variant_name)) group.pickupLabels.push(row.variant_name);
    if (row.fulfil_status !== "fulfilled") group.allFulfilled = false;
    group.items.push({ name: row.product_name, quantity: row.quantity });
  }
  return [...groups.values()].map(({ allFulfilled, token, ...group }) => ({
    ...group,
    status: allFulfilled ? "collected" : "pending",
    eventToken: token,
  }));
}
