import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { applyTripOrder, getTripDayDates, getTripScheduleIssue } from "@/lib/customer/trip-planner";
import { highestDefaultTripNumber } from "@/lib/customer/trip-name";

export type Trip = {
  id: string;
  user_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

export type TripItem = {
  id: string;
  trip_id: string;
  experience_id: string | null;
  sequence: number;
  scheduled_date: string | null;
  scheduled_time: string | null;
  created_at: string;
  source: "vendor" | "location";
  kind?: "custom" | "gps";
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  /** Outlet the stop was planned at; null for location stops and stops added before outlets were saved. */
  outlet_id?: string | null;
  is_day_origin?: boolean;
};

export type AddTripItemInput = {
  trip_id: string;
  experience_id?: string;
  source: "vendor" | "location";
  kind?: "custom" | "gps";
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  outlet_id?: string | null;
  is_day_origin?: boolean;
};

type DbTrip = Trip & { legacy_id?: string | null };
type DbTripItem = TripItem & { kind: TripItem["kind"] | null; sublabel: string | null; legacy_id?: string | null };
type CompactTripItem = [
  string, string, string | null, number, string | null, string | null, string,
  TripItem["source"], TripItem["kind"] | null, number, number, string, string | null,
];

const SEED_TRIP_PREFIX = "mock-trip-";
const SEED_ITEM_PREFIX = "seed-";
const LEGACY_MOCK_USER_ID = "mock-user";
// PostgreSQL UUID columns accept any canonical hex UUID shape; catalogue IDs
// may not encode RFC 4122 version/variant bits in the conventional ranges.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseLegacyTripItems(value: string | undefined): TripItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Array<TripItem | CompactTripItem>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => Array.isArray(item) ? ({
      id: item[0], trip_id: item[1], experience_id: item[2], sequence: item[3],
      scheduled_date: item[4], scheduled_time: item[5], created_at: item[6],
      source: item[7], kind: item[8] ?? undefined, lat: item[9], lng: item[10],
      label: item[11], sublabel: item[12] ?? undefined,
    }) : item);
  } catch {
    return [];
  }
}

async function requireOwner(db: SupabaseClient) {
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user?.id) throw new Error("Authentication required");
  return user.id;
}

function toTrip(row: DbTrip): Trip {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toTripItem(row: DbTripItem): TripItem {
  return {
    id: row.id,
    trip_id: row.trip_id,
    experience_id: row.experience_id,
    sequence: row.sequence,
    scheduled_date: row.scheduled_date,
    scheduled_time: row.scheduled_time,
    created_at: row.created_at,
    source: row.source,
    kind: row.kind ?? undefined,
    lat: Number(row.lat),
    lng: Number(row.lng),
    label: row.label,
    sublabel: row.sublabel ?? undefined,
    outlet_id: row.outlet_id ?? null,
    is_day_origin: row.is_day_origin ?? false,
  };
}

function throwOnError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

/**
 * Import only customer-created records from the former browser-cookie planner.
 * The three built-in sample trips and their sample stops deliberately stay out
 * of the real database. legacy_id makes this one-time bridge idempotent.
 */
async function importLegacyCustomerTrips(db: SupabaseClient, ownerId: string) {
  const cookieStore = await cookies();
  const rawTrips = cookieStore.get("MOCK_TRIPS")?.value;
  const rawItems = cookieStore.get("MOCK_TRIP_ITEMS")?.value;
  if (!rawTrips) return;

  let cookieTrips: Array<Partial<Trip>>;
  try {
    const parsed = JSON.parse(rawTrips) as unknown;
    cookieTrips = Array.isArray(parsed) ? parsed as Array<Partial<Trip>> : [];
  } catch {
    return;
  }

  const legacyTrips = cookieTrips.filter((trip): trip is Partial<Trip> & Pick<Trip, "id" | "name"> =>
    typeof trip.id === "string" && trip.id.length > 0 && !trip.id.startsWith(SEED_TRIP_PREFIX) &&
    typeof trip.name === "string" && trip.name.trim().length > 0 &&
    (trip.user_id === ownerId || trip.user_id === LEGACY_MOCK_USER_ID),
  );
  if (legacyTrips.length === 0) return;

  const legacyTripIds = legacyTrips.map((trip) => trip.id);
  const { data: existingTrips, error: existingTripsError } = await db
    .from("trips").select("id, legacy_id").eq("user_id", ownerId).in("legacy_id", legacyTripIds);
  throwOnError(existingTripsError, "Could not load saved trips");
  const tripIds = new Map<string, string>((existingTrips ?? []).map((row: { id: string; legacy_id: string }) => [row.legacy_id, row.id]));

  for (const trip of legacyTrips) {
    if (tripIds.has(trip.id)) continue;
    const row = {
      id: randomUUID(),
      user_id: ownerId,
      legacy_id: trip.id,
      name: trip.name.trim().slice(0, 120),
      start_date: typeof trip.start_date === "string" ? trip.start_date : null,
      end_date: typeof trip.end_date === "string" ? trip.end_date : null,
      created_at: typeof trip.created_at === "string" ? trip.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db.from("trips").insert(row).select("id, legacy_id").single();
    throwOnError(error, "Could not migrate saved trip");
    if (data) tripIds.set(data.legacy_id, data.id);
  }

  const tripItemRows = parseLegacyTripItems(rawItems).filter((item) =>
    !item.id.startsWith(SEED_ITEM_PREFIX) && tripIds.has(item.trip_id) &&
    typeof item.label === "string" && Number.isFinite(item.lat) && Number.isFinite(item.lng),
  );
  for (const legacyTrip of legacyTrips) {
    const dbTripId = tripIds.get(legacyTrip.id);
    if (!dbTripId) continue;
    const items = tripItemRows.filter((item) => item.trip_id === legacyTrip.id);
    if (items.length === 0) continue;
    const legacyItemIds = items.map((item) => item.id);
    const { data: existingItems, error: existingItemsError } = await db
      .from("trip_items").select("legacy_id").eq("trip_id", dbTripId).in("legacy_id", legacyItemIds);
    throwOnError(existingItemsError, "Could not load saved trip stops");
    const existingIds = new Set((existingItems ?? []).map((row: { legacy_id: string }) => row.legacy_id));

    for (const item of items) {
      if (existingIds.has(item.id)) continue;
      const experienceId = typeof item.experience_id === "string" && UUID_PATTERN.test(item.experience_id)
        ? item.experience_id
        : null;
      const row = {
        id: randomUUID(), trip_id: dbTripId, legacy_id: item.id,
        experience_id: experienceId, sequence: Number.isInteger(item.sequence) ? item.sequence : 0,
        scheduled_date: item.scheduled_date ?? null, scheduled_time: item.scheduled_time ?? null,
        source: item.source === "location" ? "location" : "vendor",
        kind: item.kind === "gps" || item.kind === "custom" ? item.kind : null,
        lat: item.lat, lng: item.lng, label: item.label.trim().slice(0, 200),
        sublabel: typeof item.sublabel === "string" ? item.sublabel.slice(0, 300) : null,
        created_at: item.created_at || new Date().toISOString(),
      };
      const { error } = await db.from("trip_items").insert(row);
      throwOnError(error, "Could not migrate saved trip stop");
    }
  }
}

async function getOwnedTrip(db: SupabaseClient, tripId: string, ownerId: string): Promise<Trip | null> {
  let query = db.from("trips").select("id,user_id,name,start_date,end_date,created_at,updated_at")
    .eq("user_id", ownerId);
  query = UUID_PATTERN.test(tripId) ? query.eq("id", tripId) : query.eq("legacy_id", tripId);
  const { data, error } = await query.maybeSingle();
  throwOnError(error, "Could not load trip");
  return data ? toTrip(data as DbTrip) : null;
}

export async function getTrips(db: SupabaseClient): Promise<Trip[]> {
  const ownerId = await requireOwner(db);
  await importLegacyCustomerTrips(db, ownerId);
  const { data, error } = await db.from("trips")
    .select("id,user_id,name,start_date,end_date,created_at,updated_at")
    .eq("user_id", ownerId).order("created_at", { ascending: false });
  throwOnError(error, "Could not load trips");
  return (data ?? []).map((row: DbTrip) => toTrip(row));
}

export async function getTripNameSequence(db: SupabaseClient) {
  return highestDefaultTripNumber(await getTrips(db));
}

export async function createTrip(
  input: { name: string; start_date?: string; end_date?: string },
  db: SupabaseClient,
): Promise<Trip | null> {
  const ownerId = await requireOwner(db);
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Trip name is required");
  if (input.start_date && input.end_date && input.end_date < input.start_date) {
    throw new Error("Trip end date must be on or after the start date");
  }
  const now = new Date().toISOString();
  const { data, error } = await db.from("trips").insert({
    id: randomUUID(), user_id: ownerId, name,
    start_date: input.start_date || null, end_date: input.end_date || null,
    created_at: now, updated_at: now,
  }).select("id,user_id,name,start_date,end_date,created_at,updated_at").single();
  throwOnError(error, "Could not create trip");
  return data ? toTrip(data as DbTrip) : null;
}

export async function addTripItem(input: AddTripItemInput, db: SupabaseClient): Promise<TripItem> {
  const ownerId = await requireOwner(db);
  const trip = await getOwnedTrip(db, input.trip_id, ownerId);
  if (!trip) throw new Error("Trip not found");
  if (input.scheduled_date && !getTripDayDates(trip).includes(input.scheduled_date)) {
    throw new Error("Scheduled date is outside this trip");
  }
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90 ||
      !Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
    throw new Error("Trip stop coordinates are invalid");
  }
  if (!input.label.trim() || input.label.length > 200) throw new Error("Trip stop name is required");
  if (input.source === "vendor" && (!input.experience_id || !UUID_PATTERN.test(input.experience_id))) {
    throw new Error("A valid activity is required");
  }
  if (input.outlet_id && (input.source !== "vendor" || !UUID_PATTERN.test(input.outlet_id))) {
    throw new Error("A valid outlet is required");
  }
  if (input.is_day_origin && (input.source !== "location" || input.experience_id || !input.scheduled_date || input.scheduled_time)) throw new Error("Invalid daily origin");
  const { data: existing, error: existingError } = await db.from("trip_items")
    .select("*").eq("trip_id", trip.id).order("sequence", { ascending: true });
  throwOnError(existingError, "Could not load trip stops");
  if (input.is_day_origin && existing?.some((row: DbTripItem)=>row.is_day_origin && row.scheduled_date === input.scheduled_date)) throw new Error("Daily origin already exists");
  const sequence = existing?.length ? Math.max(...existing.map((row: DbTripItem) => Number(row.sequence))) + 1 : 0;
  const row = {
    id: randomUUID(), trip_id: trip.id,
    experience_id: input.source === "vendor" ? input.experience_id! : null,
    sequence, scheduled_date: input.scheduled_date ?? null, scheduled_time: input.scheduled_time ?? null,
    source: input.source, kind: input.kind ?? null, lat: input.lat, lng: input.lng,
    label: input.label.trim(), sublabel: input.sublabel?.trim() || null,
    ...(input.outlet_id ? { outlet_id: input.outlet_id } : {}),
    ...(input.is_day_origin ? {is_day_origin:true} : {}),
    created_at: new Date().toISOString(),
  };
  if (input.is_day_origin) {
    const existingItems = (existing ?? []).map((item: DbTripItem) => toTripItem(item));
    const orderedIds = existingItems.map(item => item.id);
    const firstSameDayIndex = existingItems.findIndex(item => item.scheduled_date === input.scheduled_date);
    orderedIds.splice(firstSameDayIndex < 0 ? orderedIds.length : firstSameDayIndex, 0, row.id);
    const proposedItems = applyTripOrder([...existingItems, toTripItem(row as DbTripItem)], orderedIds);
    assertTripSchedule(trip, proposedItems);
    const existingById = new Map((existing ?? []).map((item: DbTripItem) => [item.id, item]));
    const rowsToSave = proposedItems.map(item => item.id === row.id
      ? {...row, sequence:item.sequence}
      : {...existingById.get(item.id)!, sequence:item.sequence});
    const {data, error} = await db.from("trip_items").upsert(rowsToSave, {onConflict:"id"}).select("*");
    throwOnError(error, "Could not add trip stop");
    const saved = (data ?? []).find((item: DbTripItem) => item.id === row.id);
    if (!saved) throw new Error("Could not add trip stop");
    return toTripItem(saved as DbTripItem);
  }
  assertTripSchedule(trip, [...(existing ?? []).map((item: DbTripItem) => toTripItem(item)), toTripItem(row as DbTripItem)]);
  const { data, error } = await db.from("trip_items").insert(row).select("*").single();
  throwOnError(error, "Could not add trip stop");
  if (!data) throw new Error("Could not add trip stop");
  return toTripItem(data as DbTripItem);
}

export async function getTripById(tripId: string, db: SupabaseClient): Promise<Trip | null> {
  const ownerId = await requireOwner(db);
  await importLegacyCustomerTrips(db, ownerId);
  return getOwnedTrip(db, tripId, ownerId);
}

export async function getTripItems(tripId: string, db: SupabaseClient): Promise<TripItem[]> {
  const ownerId = await requireOwner(db);
  await importLegacyCustomerTrips(db, ownerId);
  const trip = await getOwnedTrip(db, tripId, ownerId);
  if (!trip) return [];
  const { data, error } = await db.from("trip_items").select("*")
    .eq("trip_id", trip.id).order("sequence", { ascending: true });
  throwOnError(error, "Could not load trip stops");
  return (data ?? []).map((row: DbTripItem) => toTripItem(row));
}

async function getOwnedTripItem(db: SupabaseClient, itemId: string) {
  const trips = await getTrips(db);
  const tripIds = trips.map((trip) => trip.id);
  if (!tripIds.length) return null;
  const { data, error } = await db.from("trip_items").select("*")
    .eq("id", itemId).in("trip_id", tripIds).maybeSingle();
  throwOnError(error, "Could not load trip stop");
  return data as DbTripItem | null;
}

export async function updateTripItem(
  itemId: string,
  updates: { sequence?: number; scheduled_date?: string | null; scheduled_time?: string | null },
  db: SupabaseClient,
): Promise<TripItem> {
  const item = await getOwnedTripItem(db, itemId);
  if (!item) throw new Error("Trip not found");
  const currentItems = await getTripItems(item.trip_id, db);
  const proposedItems = currentItems.map((entry) => entry.id === itemId ? {
    ...entry,
    ...(updates.sequence === undefined ? {} : { sequence: updates.sequence }),
    ...(updates.scheduled_date === undefined ? {} : { scheduled_date: updates.scheduled_date }),
    ...(updates.scheduled_time === undefined ? {} : { scheduled_time: updates.scheduled_time }),
  } : entry);
  const trip = await getTripById(item.trip_id, db);
  if (!trip) throw new Error("Trip not found");
  if (updates.sequence !== undefined) throw new Error("Use full-trip reorder to change sequence");
  assertTripSchedule(trip, proposedItems);
  const { data, error } = await db.from("trip_items").update({
    ...(updates.sequence === undefined ? {} : { sequence: updates.sequence }),
    ...(updates.scheduled_date === undefined ? {} : { scheduled_date: updates.scheduled_date }),
    ...(updates.scheduled_time === undefined ? {} : { scheduled_time: updates.scheduled_time }),
  }).eq("id", itemId).eq("trip_id", item.trip_id).select("*").single();
  throwOnError(error, "Could not update trip stop");
  if (!data) throw new Error("Trip stop not found");
  return toTripItem(data as DbTripItem);
}

export async function reorderTripItems(tripId: string, reorderedItemIds: string[], db: SupabaseClient): Promise<TripItem[]> {
  const ownerId = await requireOwner(db);
  const trip = await getOwnedTrip(db, tripId, ownerId);
  if (!trip) throw new Error("Trip not found");
  const {data: rows, error: loadError} = await db.from("trip_items").select("*").eq("trip_id", trip.id);
  throwOnError(loadError, "Could not load trip stops");
  const raw = (rows ?? []) as DbTripItem[];
  const proposedItems = applyTripOrder(raw.map(toTripItem), reorderedItemIds);
  assertTripSchedule(trip, proposedItems);
  if (!proposedItems.length) return [];
  // Keep every stored field, including legacy metadata, outlet and creation time.
  const storedById = new Map(raw.map(row => [row.id, row]));
  const {data, error} = await db.from("trip_items").upsert(proposedItems.map(item => ({...storedById.get(item.id)!, sequence:item.sequence})), {onConflict:"id"}).select("*");
  throwOnError(error, "Could not reorder trip stops");
  return ((data ?? []) as DbTripItem[]).map(toTripItem).sort((a,b)=>a.sequence-b.sequence);
}

export async function updateTripItemLocation(
  itemId: string,
  updates: { label: string; lat: number; lng: number },
  db: SupabaseClient,
): Promise<TripItem> {
  const item = await getOwnedTripItem(db, itemId);
  if (!item || item.source !== "location") throw new Error("Trip stop not found");
  if (!updates.label.trim() || updates.label.length > 200 || !Number.isFinite(updates.lat) ||
      updates.lat < -90 || updates.lat > 90 || !Number.isFinite(updates.lng) ||
      updates.lng < -180 || updates.lng > 180) throw new Error("Trip stop details are invalid");
  const { data, error } = await db.from("trip_items").update({
    label: updates.label.trim(), lat: updates.lat, lng: updates.lng,
  }).eq("id", itemId).eq("trip_id", item.trip_id).eq("source", "location").select("*").single();
  throwOnError(error, "Could not update trip stop");
  if (!data) throw new Error("Trip stop not found");
  return toTripItem(data as DbTripItem);
}

export async function deleteTripItem(itemId: string, db: SupabaseClient): Promise<void> {
  const item = await getOwnedTripItem(db, itemId);
  if (!item) throw new Error("Trip not found");
  const { error } = await db.from("trip_items").delete().eq("id", itemId).eq("trip_id", item.trip_id);
  throwOnError(error, "Could not delete trip stop");
}

export async function deleteTrip(tripId: string, db: SupabaseClient): Promise<void> {
  const ownerId = await requireOwner(db);
  const trip = await getOwnedTrip(db, tripId, ownerId);
  if (!trip) return;
  const { error } = await db.from("trips").delete().eq("id", trip.id).eq("user_id", ownerId);
  throwOnError(error, "Could not delete trip");
}

function assertTripSchedule(trip: Trip, items: TripItem[]) {
  if (items.some(item=>item.is_day_origin && (item.source !== "location" || item.experience_id || !item.scheduled_date || item.scheduled_time))) throw new Error("Invalid daily origin");
  const issue = getTripScheduleIssue(trip, items);
  if (issue) throw new Error(issue === "non_chronological"
    ? "Trip times must follow itinerary order"
    : issue === "daily_origin_order"
      ? "Daily starting point must be first on its day"
      : `Invalid trip schedule: ${issue}`);
}

export async function clearTripItems(tripId: string, db: SupabaseClient): Promise<void> {
  const trip = await getOwnedTrip(db, tripId, await requireOwner(db));
  if (!trip) throw new Error("Trip not found");
  const {error} = await db.from("trip_items").delete().eq("trip_id", trip.id);
  throwOnError(error, "Could not clear trip stops");
}

/** Resolve public listing data on the server; never trust a suggested pin's fields. */
export async function replaceTripItem(itemId: string, replacement: {experience_id: string; outlet_id?: string | null}, db: SupabaseClient): Promise<TripItem> {
  const item = await getOwnedTripItem(db, itemId);
  if (!item || item.source !== "vendor") throw new Error("Trip stop not found");
  if (!UUID_PATTERN.test(replacement.experience_id) || (replacement.outlet_id && !UUID_PATTERN.test(replacement.outlet_id))) throw new Error("Invalid replacement");
  const {getComputedActivity, getBookingSlots} = await import("@/backend/domains/catalogue");
  const activity = await getComputedActivity(replacement.experience_id, undefined, db, replacement.outlet_id ?? undefined);
  if (!activity || (replacement.outlet_id && activity.outlet.id !== replacement.outlet_id)) throw new Error("Replacement is unavailable at this outlet");
  if (item.scheduled_date) {
    const {getTripTimeChoices, getTripTimeProblem} = await import("@/lib/customer/trip-time-options");
    const choices = getTripTimeChoices({activity, date:item.scheduled_date, outletId:activity.outlet.id, slots:activity.requiresBooking ? await getBookingSlots(activity.id, db) : [], hours:activity.outlet.operatingHours ?? null});
    if ((choices.kind === "none" && item.scheduled_time !== null) || getTripTimeProblem(choices, item.scheduled_time, activity.outlet.operatingHours, item.scheduled_date) || ((choices.kind === "slots" || choices.kind === "hours") && !choices.options.some(option=>option.available))) throw new Error("Replacement does not fit the saved schedule");
  }
  const {data, error} = await db.from("trip_items").update({experience_id:activity.id, outlet_id:activity.outlet.id, label:activity.name, sublabel:activity.outlet.city, lat:activity.outlet.lat, lng:activity.outlet.lng}).eq("id", item.id).eq("trip_id", item.trip_id).select("*").single();
  throwOnError(error, "Could not replace trip stop");
  if (!data) throw new Error("Trip stop not found");
  return toTripItem(data as DbTripItem);
}
