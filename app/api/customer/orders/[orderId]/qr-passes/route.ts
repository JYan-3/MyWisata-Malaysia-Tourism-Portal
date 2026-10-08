import { apiFail, apiOk } from "@/lib/validation/schemas";
import { createClient } from "@/lib/supabase/server";
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

export async function GET(_request: Request, { params }: Props) {
  const { orderId } = await params;
  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) return apiFail("UNAUTHORIZED", "Sign in to view order passes", 401);

  const { data: order, error: orderError } = await db
    .from("orders")
    .select("id,status")
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (orderError) return apiFail("DB_ERROR", orderError.message, 500);
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
    const eventPickups = await loadEventPickups(db, orderId);
    if (!eventPickups) return apiFail("DB_ERROR", "Unable to load event pickup passes", 500);
    return apiOk({ tickets, foodOrders: [], eventPickups });
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
  const eventPickups = await loadEventPickups(db, orderId);
  if (!eventPickups) return apiFail("DB_ERROR", "Unable to load event pickup passes", 500);
  return apiOk({ tickets, foodOrders, eventPickups });
}

type EventPickupRow = {
  vendor_id: string;
  event_location_id: string;
  pickup_date: string;
  pickup_slot_id: string | null;
  slot_starts_at: string | null;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  fulfil_status: string;
  vendors: { name: string } | { name: string }[] | null;
};

/** Slot-bound codes are issued per saved vendor/location/date/slot group. */
async function loadEventPickups(db: Awaited<ReturnType<typeof createClient>>, orderId: string) {
  const { data, error } = await db
    .from("order_items")
    .select("vendor_id,event_location_id,pickup_date,pickup_slot_id,slot_starts_at,product_name,variant_name,quantity,fulfil_status,vendors(name)")
    .eq("order_id", orderId);
  if (error) return null;
  const rows = ((data ?? []) as EventPickupRow[]).filter((row) => row.event_location_id && row.pickup_date && row.fulfil_status !== "cancelled");
  const dateGroups = new Map<string, EventPickupRow[]>();
  for (const row of rows) {
    const dateKey = `${row.vendor_id}:${row.event_location_id}:${row.pickup_date}`;
    const group = dateGroups.get(dateKey) ?? [];
    group.push(row);
    dateGroups.set(dateKey, group);
  }
  const groups = new Map<string, {
    vendorName: string;
    pickupDate: string;
    pickupLabels: string[];
    allFulfilled: boolean;
    items: { name: string; quantity: number }[];
    token: string;
  }>();
  for (const dateRows of dateGroups.values()) {
    // If a historical row lost its slot FK, keep a single date-only QR for the
    // whole date group. The scanner and database then apply the stricter legacy
    // rule: all still-open saved pickup times must have started.
    const allRowsHaveSlot = dateRows.every((row) => Boolean(row.pickup_slot_id && row.slot_starts_at && Number.isFinite(new Date(row.slot_starts_at).getTime())));
    const slotGroups = new Map<string, EventPickupRow[]>();
    for (const row of dateRows) {
      const key = allRowsHaveSlot ? (row.pickup_slot_id as string) : "legacy-date";
      const group = slotGroups.get(key) ?? [];
      group.push(row);
      slotGroups.set(key, group);
    }
    for (const [slotKey, slotRows] of slotGroups) {
      const row = slotRows[0];
      const key = `${row.vendor_id}:${row.event_location_id}:${row.pickup_date}:${slotKey}`;
      let group = groups.get(key);
      if (!group) {
        const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors;
        group = {
          vendorName: vendor?.name ?? "",
          pickupDate: row.pickup_date,
          pickupLabels: [],
          allFulfilled: true,
          items: [],
          token: signEventPickupToken({
            orderId,
            vendorId: row.vendor_id,
            locationId: row.event_location_id,
            pickupDate: row.pickup_date,
            ...(allRowsHaveSlot ? { pickupSlotId: row.pickup_slot_id as string } : {}),
            issuedAt: Date.now(),
          }),
        };
        groups.set(key, group);
      }
      for (const slotRow of slotRows) {
        if (slotRow.variant_name && !group.pickupLabels.includes(slotRow.variant_name)) group.pickupLabels.push(slotRow.variant_name);
        if (slotRow.fulfil_status !== "fulfilled") group.allFulfilled = false;
        group.items.push({ name: slotRow.product_name, quantity: slotRow.quantity });
      }
    }
  }
  return [...groups.values()].map(({ allFulfilled, token, ...group }) => ({
    ...group,
    status: allFulfilled ? "collected" : "pending",
    eventToken: token,
  }));
}
