import { apiFail, apiOk } from '@/lib/validation/schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { outletLocation, outletShortName } from '@/lib/outlet-display';
import { formatTicketAdmissionDetails } from '@/lib/vendor/redemption-admission-details';

interface Props {
  params: Promise<{ vendorId: string }>;
}

export interface RedemptionRecord {
  id: string;
  kind: 'voucher' | 'ticket' | 'event_pickup';
  redeemedAt: string;
  outlet: {
    id: string;
    name: string;
    fullName: string;
    location: string;
  };
  item: {
    code?: string;
    name: string;
    details: string;
    discountValue?: number;
  };
  customer: {
    name: string;
    email: string;
  };
  staff?: {
    name: string;
    email: string;
  } | null;
}

type EventPickupAuditRow = {
  id: string;
  actor_id: string | null;
  entity_id: string;
  created_at: string;
  after_data: Record<string, unknown> | null;
};

export async function GET(request: Request, { params }: Props) {
  const { vendorId } = await params;
  const access = await authorizeVendor(vendorId, undefined, { allowEventVendor: true });
  if (!access.ok) return access.response;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get('pageSize')) || 15));
  const outletId = searchParams.get('outletId') || '';
  const kind = searchParams.get('kind') || 'all'; // 'all' | 'voucher' | 'ticket' | 'event_pickup'
  const q = (searchParams.get('q') || '').trim().toLowerCase();

  const service = access.access.serviceDb;
  const vendorOutletIds = access.access.outletIds;
  const targetOutletIds = outletId ? [outletId] : vendorOutletIds;

  // 1. Query voucher store redemptions
  let voucherRows: any[] = [];
  if (targetOutletIds.length > 0 && (kind === 'all' || kind === 'voucher')) {
    const query = service
      .from('voucher_store_redemptions')
      .select('id, claim_id, voucher_id, outlet_id, user_id, redeemed_by, token_fingerprint, redeemed_at, vouchers(id, code, name, voucher_type, discount_value), outlets(id, name, city, state)')
      .eq('vendor_id', vendorId)
      .in('outlet_id', targetOutletIds)
      .order('redeemed_at', { ascending: false });

    const { data } = await query;
    voucherRows = data || [];
  }

  // 2. Query ticket scan events. Every successful scan has its own audit row,
  // including repeated multi-entry visits and partial group admissions.
  let ticketRows: any[] = [];
  let legacyTicketRows: any[] = [];
  if (targetOutletIds.length > 0 && (kind === 'all' || kind === 'ticket')) {
    const [eventResult, legacyResult] = await Promise.all([
      service
        .from('check_in_events')
        .select('id, entries_admitted, entries_used_after, scanned_at, vendor_id, outlet_id, bookings!inner(id, display_id, users(id, full_name, email), order_items!inner(vendor_id, outlet_id, product_name)), ticket_passes!inner(policy), outlets(id, name, city, state)')
        .eq('vendor_id', vendorId)
        .in('outlet_id', targetOutletIds)
        .order('scanned_at', { ascending: false }),
      service
        .from('bookings')
        .select('id, display_id, check_in_at, customer_id, users(id, full_name, email), order_items!inner(vendor_id, outlet_id, product_name, quantity, line_total, outlets(id, name, city, state)), ticket_passes(policy, entries_used)')
        .eq('order_items.vendor_id', vendorId)
        .in('order_items.outlet_id', targetOutletIds)
        .not('check_in_at', 'is', null)
        .order('check_in_at', { ascending: false }),
    ]);
    ticketRows = eventResult.data || [];
    const bookingsWithEvents = new Set(ticketRows.map((row) => {
      const booking = Array.isArray(row.bookings) ? row.bookings[0] : row.bookings;
      return booking?.id;
    }).filter(Boolean));
    // Keep pre-audit-log check-ins visible without duplicating bookings that
    // now have immutable per-scan events.
    legacyTicketRows = (legacyResult.data || []).filter((row) => !bookingsWithEvents.has(row.id));
  }

  // Event vendors have no outlets. Event pickup fulfilment is recorded in the
  // immutable audit log and is scoped by its signed vendor metadata.
  let eventPickupRows: EventPickupAuditRow[] = [];
  if (kind === 'all' || kind === 'event_pickup') {
    const { data, error } = await service
      .from('audit_logs')
      .select('id,actor_id,entity_id,created_at,after_data')
      .eq('action', 'event_pickup.fulfilled')
      .eq('entity_type', 'order')
      .eq('after_data->>vendor_id', vendorId)
      .order('created_at', { ascending: false });
    if (error) return apiFail('DB_ERROR', error.message, 500);
    eventPickupRows = (data || []) as EventPickupAuditRow[];
  }

  const eventOrderIds = [...new Set(eventPickupRows.map((row) => row.entity_id).filter(Boolean))];
  const eventLocationIds = [...new Set(eventPickupRows.map((row) => row.after_data?.location_id).filter(Boolean))];
  const [eventOrdersResult, eventLocationsResult] = await Promise.all([
    eventOrderIds.length
      ? service.from('orders').select('id,user_id').in('id', eventOrderIds)
      : Promise.resolve({ data: [], error: null }),
    eventLocationIds.length
      ? service.from('promotion_campaign_locations').select('id,name,address').in('id', eventLocationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventOrdersResult.error) return apiFail('DB_ERROR', eventOrdersResult.error.message, 500);
  if (eventLocationsResult.error) return apiFail('DB_ERROR', eventLocationsResult.error.message, 500);
  const eventOrders = new Map((eventOrdersResult.data || []).map((row: { id: string; user_id: string | null }) => [row.id, row]));
  const eventLocations = new Map((eventLocationsResult.data || []).map((row: { id: string; name: string; address: string | null }) => [row.id, row]));

  // 3. Collect unique user IDs for voucher records (customers and staff)
  const userIds = new Set<string>();
  voucherRows.forEach((r) => {
    if (r.user_id) userIds.add(r.user_id);
    if (r.redeemed_by) userIds.add(r.redeemed_by);
  });
  eventPickupRows.forEach((row) => {
    const order = eventOrders.get(row.entity_id);
    const orderUserId = order && typeof order === 'object' && 'user_id' in order ? order.user_id : null;
    if (orderUserId) userIds.add(orderUserId);
    if (row.actor_id) userIds.add(row.actor_id);
  });

  const usersMap = new Map<string, { name: string; email: string }>();
  if (userIds.size > 0) {
    const { data: userRecords } = await service
      .from('users')
      .select('id, full_name, email')
      .in('id', [...userIds]);

    (userRecords || []).forEach((u: { id: string; full_name?: string | null; email?: string | null }) => {
      usersMap.set(u.id, {
        name: u.full_name || 'Anonymous Customer',
        email: u.email || '—',
      });
    });
  }

  // 4. Transform into unified RedemptionRecord format
  const allRecords: RedemptionRecord[] = [];

  // Vouchers
  voucherRows.forEach((row) => {
    const voucher = Array.isArray(row.vouchers) ? row.vouchers[0] : row.vouchers;
    const outlet = Array.isArray(row.outlets) ? row.outlets[0] : row.outlets;
    const customer = usersMap.get(row.user_id) || { name: 'Verified Customer', email: '—' };
    const staff = usersMap.get(row.redeemed_by) || null;

    const discountValue = Number(voucher?.discount_value || 0);
    const details = voucher?.voucher_type === 'percent'
      ? `${discountValue}% OFF`
      : voucher?.voucher_type === 'fixed'
        ? `RM${discountValue.toFixed(2)} OFF`
        : 'Buy 1 Free 1';

    allRecords.push({
      id: row.id,
      kind: 'voucher',
      redeemedAt: row.redeemed_at,
      outlet: {
        id: outlet?.id || row.outlet_id,
        name: outletShortName(outlet?.name, access.access.vendorId),
        fullName: outlet?.name || 'Assigned outlet',
        location: outletLocation(outlet?.city, outlet?.state),
      },
      item: {
        code: voucher?.code || '—',
        name: voucher?.name || 'Store Voucher',
        details,
        discountValue,
      },
      customer,
      staff,
    });
  });

  // Tickets
  let ticketAdmissions = 0;
  ticketRows.forEach((row) => {
    const booking = Array.isArray(row.bookings) ? row.bookings[0] : row.bookings;
    const rawItems = Array.isArray(booking?.order_items) ? booking.order_items : [booking?.order_items];
    const orderItem = rawItems[0];
    const outlet = Array.isArray(orderItem?.outlets) ? orderItem.outlets[0] : orderItem?.outlets;
    const eventOutlet = Array.isArray(row.outlets) ? row.outlets[0] : row.outlets;
    const customerRecord = Array.isArray(booking?.users) ? booking.users[0] : booking?.users;
    const pass = Array.isArray(row.ticket_passes) ? row.ticket_passes[0] : row.ticket_passes;
    const admittedCount = Number(row.entries_admitted);
    ticketAdmissions += Number.isSafeInteger(admittedCount) && admittedCount > 0 ? admittedCount : 0;

    allRecords.push({
      id: row.id,
      kind: 'ticket',
      redeemedAt: row.scanned_at,
      outlet: {
        id: eventOutlet?.id || row.outlet_id || outlet?.id || orderItem?.outlet_id || '',
        name: outletShortName(eventOutlet?.name || outlet?.name, access.access.vendorId),
        fullName: eventOutlet?.name || outlet?.name || 'Assigned outlet',
        location: outletLocation(eventOutlet?.city || outlet?.city, eventOutlet?.state || outlet?.state),
      },
      item: {
        code: booking?.display_id || booking?.id?.slice(0, 8).toUpperCase(),
        name: orderItem?.product_name || 'Experience Ticket',
        details: formatTicketAdmissionDetails(pass?.policy, admittedCount),
      },
      customer: {
        name: customerRecord?.full_name || 'Guest Ticket Holder',
        email: customerRecord?.email || '—',
      },
      staff: null,
    });
  });

  legacyTicketRows.forEach((row) => {
    const rawItems = Array.isArray(row.order_items) ? row.order_items : [row.order_items];
    const orderItem = rawItems[0];
    const outlet = Array.isArray(orderItem?.outlets) ? orderItem.outlets[0] : orderItem?.outlets;
    const customerRecord = Array.isArray(row.users) ? row.users[0] : row.users;
    const pass = Array.isArray(row.ticket_passes) ? row.ticket_passes[0] : row.ticket_passes;
    const admittedCount = Number(pass?.entries_used ?? orderItem?.quantity ?? 1);
    ticketAdmissions += Number.isSafeInteger(admittedCount) && admittedCount > 0 ? admittedCount : 0;

    allRecords.push({
      id: row.id,
      kind: 'ticket',
      redeemedAt: row.check_in_at,
      outlet: {
        id: outlet?.id || orderItem?.outlet_id || '',
        name: outletShortName(outlet?.name, access.access.vendorId),
        fullName: outlet?.name || 'Assigned outlet',
        location: outletLocation(outlet?.city, outlet?.state),
      },
      item: {
        code: row.display_id || row.id.slice(0, 8).toUpperCase(),
        name: orderItem?.product_name || 'Experience Ticket',
        details: formatTicketAdmissionDetails(pass?.policy, admittedCount),
      },
      customer: {
        name: customerRecord?.full_name || 'Guest Ticket Holder',
        email: customerRecord?.email || '—',
      },
      staff: null,
    });
  });

  eventPickupRows.forEach((row) => {
    const after = row.after_data && typeof row.after_data === 'object' ? row.after_data as Record<string, unknown> : {};
    const orderId = String(row.entity_id || '');
    const order = eventOrders.get(orderId);
    const locationId = String(after.location_id || '');
    const location = eventLocations.get(locationId);
    const customer = usersMap.get(order?.user_id || '') || { name: 'Verified Customer', email: '—' };
    const staff = usersMap.get(row.actor_id || '') || null;
    const itemDetails = Array.isArray(after.item_details)
      ? after.item_details.filter((item): item is { name: string; quantity: number } => Boolean(item && typeof item === 'object' && 'name' in item && typeof item.name === 'string' && 'quantity' in item && typeof item.quantity === 'number'))
      : [];
    const itemNames = [...new Set(itemDetails.map((item) => item.name))];
    const pickupDate = typeof after.pickup_date === 'string' ? after.pickup_date : '—';
    const pickupTimes = Array.isArray(after.pickup_times)
      ? after.pickup_times.flatMap((value) => {
          if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) return [];
          return [new Date(value).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })];
        })
      : [];
    const details = [pickupDate, ...pickupTimes, ...itemDetails.map((item) => `${item.name} × ${item.quantity}`)].join(' · ');

    allRecords.push({
      id: row.id,
      kind: 'event_pickup',
      redeemedAt: row.created_at,
      outlet: {
        id: locationId,
        name: location?.name || 'Event location',
        fullName: location?.name || 'Event location',
        location: location?.address || '',
      },
      item: {
        code: orderId.slice(0, 8).toUpperCase(),
        name: itemNames.length ? itemNames.join(', ') : 'Event pickup',
        details,
      },
      customer,
      staff,
    });
  });

  // Sort by redeemedAt descending
  allRecords.sort((a, b) => new Date(b.redeemedAt).getTime() - new Date(a.redeemedAt).getTime());

  // Filter by search query if present
  const filteredRecords = q
    ? allRecords.filter((rec) =>
        rec.item.name.toLowerCase().includes(q) ||
        rec.item.details.toLowerCase().includes(q) ||
        (rec.item.code && rec.item.code.toLowerCase().includes(q)) ||
        rec.customer.name.toLowerCase().includes(q) ||
        rec.customer.email.toLowerCase().includes(q) ||
        rec.outlet.name.toLowerCase().includes(q) ||
        (rec.staff && rec.staff.name.toLowerCase().includes(q)),
      )
    : allRecords;

  // Stats calculation
  const malaysiaDate = (value: string | Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value instanceof Date ? value : new Date(value));
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const todayStr = malaysiaDate(new Date());
  const activeOutlets = new Set(allRecords.map((r) => r.outlet.id));

  const stats = {
    totalCount: allRecords.length,
    todayCount: allRecords.filter((r) => malaysiaDate(r.redeemedAt) === todayStr).length,
    voucherCount: allRecords.filter((r) => r.kind === 'voucher').length,
    ticketCount: ticketAdmissions,
    activeOutletsCount: activeOutlets.size,
  };

  // Pagination slice
  const total = filteredRecords.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndex = (page - 1) * pageSize;
  const paginatedItems = filteredRecords.slice(startIndex, startIndex + pageSize);

  return apiOk({
    items: paginatedItems,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
    stats,
  });
}
