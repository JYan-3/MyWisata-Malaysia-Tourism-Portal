import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieValues = new Map<string, string>();
const cookieStore = {
  get: vi.fn((name: string) => cookieValues.has(name) ? { value: cookieValues.get(name)! } : undefined),
  set: vi.fn(),
};
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const {
  addTripItem,
  createTrip,
  getTripById,
  getTripItems,
  getTrips,
  reorderTripItems,
  updateTripItem,
} = await import("@/backend/domains/trips");

const OWNER_ID = "aaaaaaaa-0000-4000-8000-000000000005";
const OTHER_USER_ID = "bbbbbbbb-0000-4000-8000-000000000006";
const TRIP_ID = "10000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const NOW = "2026-09-01T00:00:00.000Z";

type Row = Record<string, unknown>;
type MemoryDatabase = { trips: Row[]; trip_items: Row[] };

class Query {
  private operation: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private filters: Array<{ column: string; operator: "eq" | "in"; value: unknown }> = [];
  private rows: Row[] = [];
  private changes: Row = {};
  private sort: { column: string; ascending: boolean } | null = null;
  private rowLimit: number | null = null;

  constructor(private readonly database: MemoryDatabase, private readonly table: keyof MemoryDatabase) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push({ column, operator: "eq", value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ column, operator: "in", value }); return this; }
  order(column: string, options?: { ascending?: boolean }) {
    this.sort = { column, ascending: options?.ascending ?? true };
    return this;
  }
  limit(count: number) { this.rowLimit = count; return this; }
  insert(rows: Row | Row[]) { this.operation = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows: Row | Row[]) { this.operation = "upsert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(changes: Row) { this.operation = "update"; this.changes = changes; return this; }
  delete() { this.operation = "delete"; return this; }
  single() { return Promise.resolve({ data: this.execute()[0] ?? null, error: null }); }
  maybeSingle() { return Promise.resolve({ data: this.execute()[0] ?? null, error: null }); }
  then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve({ data: this.execute(), error: null }).then(resolve, reject);
  }

  private matches(row: Row) {
    return this.filters.every(({ column, operator, value }) => operator === "eq"
      ? row[column] === value
      : Array.isArray(value) && value.includes(row[column]));
  }

  private execute(): Row[] {
    const table = this.database[this.table];
    if (this.operation === "insert") {
      table.push(...this.rows.map((row) => ({ ...row })));
      return this.rows;
    }
    if (this.operation === "upsert") {
      for (const row of this.rows) {
        const existing = table.find((candidate) => candidate.id === row.id);
        if (existing) Object.assign(existing, row);
        else table.push({ ...row });
      }
      return this.rows;
    }
    const matching = table.filter((row) => this.matches(row));
    if (this.operation === "update") {
      matching.forEach((row) => Object.assign(row, this.changes));
      return matching;
    }
    if (this.operation === "delete") {
      this.database[this.table] = table.filter((row) => !this.matches(row));
      return matching;
    }
    const ordered = this.sort ? matching.sort((a, b) => {
      const left = a[this.sort!.column] as string | number;
      const right = b[this.sort!.column] as string | number;
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      return this.sort!.ascending ? comparison : -comparison;
    }) : matching;
    return this.rowLimit === null ? ordered : ordered.slice(0, this.rowLimit);
  }
}

function createDb(initial: Partial<MemoryDatabase> = {}, userId: string | null = OWNER_ID) {
  const database: MemoryDatabase = {
    trips: (initial.trips ?? []).map((row) => ({ ...row })),
    trip_items: (initial.trip_items ?? []).map((row) => ({ ...row })),
  };
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: userId ? null : { message: "expired" } })) },
    from: vi.fn((table: keyof MemoryDatabase) => new Query(database, table)),
  };
  return { client: client as never, database };
}

const ownedTrip = {
  id: TRIP_ID,
  user_id: OWNER_ID,
  name: "Penang",
  start_date: "2026-09-15",
  end_date: "2026-09-17",
  created_at: NOW,
  updated_at: NOW,
};

beforeEach(() => {
  cookieValues.clear();
  vi.clearAllMocks();
});

afterEach(() => vi.useRealTimers());

describe("database-backed customer trips", () => {
  it("returns only account-owned database trips and does not create demo itineraries", async () => {
    const { client, database } = createDb({
      trips: [ownedTrip, { ...ownedTrip, id: "10000000-0000-4000-8000-000000000002", user_id: OTHER_USER_ID }],
    });
    cookieValues.set("MOCK_TRIPS", JSON.stringify([{
      id: "mock-trip-demo", user_id: OWNER_ID, name: "Built-in sample",
    }]));

    const trips = await getTrips(client);

    expect(trips).toEqual([expect.objectContaining({ id: TRIP_ID, user_id: OWNER_ID })]);
    expect(database.trips).toHaveLength(2);
  });

  it("creates a durable customer trip for the authenticated account", async () => {
    const { client, database } = createDb();

    const created = await createTrip({ name: "  Alice's Malaysia trip  " }, client);

    expect(created).toMatchObject({ user_id: OWNER_ID, name: "Alice's Malaysia trip" });
    expect(database.trips).toContainEqual(expect.objectContaining({ id: created?.id, user_id: OWNER_ID }));
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("migrates a user's former cookie itinerary once and skips built-in seed rows", async () => {
    const legacyTrip = { ...ownedTrip, id: "trip-old-user-created", user_id: OWNER_ID, name: "Saved before upgrade" };
    cookieValues.set("MOCK_TRIPS", JSON.stringify([
      legacyTrip,
      { ...ownedTrip, id: "mock-trip-penang-two-days", name: "Built-in sample" },
    ]));
    cookieValues.set("MOCK_TRIP_ITEMS", JSON.stringify([
      {
        id: "loc-user-stop", trip_id: legacyTrip.id, experience_id: null, sequence: 0,
        scheduled_date: null, scheduled_time: null, created_at: NOW, source: "location",
        kind: "custom", lat: 5.4141, lng: 100.3288, label: "Saved stop",
      },
      {
        id: "seed-item-penang-national-park", trip_id: "mock-trip-penang-two-days", sequence: 0,
        source: "vendor", lat: 5.4, lng: 100.3, label: "Sample stop",
      },
    ]));
    const { client, database } = createDb();

    const trips = await getTrips(client);
    const items = await getTripItems(legacyTrip.id, client);
    await getTrips(client);

    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ name: "Saved before upgrade", user_id: OWNER_ID });
    expect(items).toEqual([expect.objectContaining({ label: "Saved stop", source: "location", lat: 5.4141 })]);
    expect(database.trips).toHaveLength(1);
    expect(database.trip_items).toHaveLength(1);
  });

  it("persists scheduled activity stops and rejects another account's trip", async () => {
    const { client, database } = createDb({ trips: [ownedTrip] });
    const item = await addTripItem({
      trip_id: TRIP_ID, experience_id: PRODUCT_ID, source: "vendor", lat: 5.4, lng: 100.3,
      label: "Food tour", scheduled_date: "2026-09-16", scheduled_time: "14:00",
    }, client);

    expect(item).toMatchObject({ trip_id: TRIP_ID, experience_id: PRODUCT_ID, scheduled_date: "2026-09-16" });
    expect(database.trip_items).toContainEqual(expect.objectContaining({ label: "Food tour", trip_id: TRIP_ID }));
    await expect(addTripItem({
      trip_id: TRIP_ID, source: "location", lat: 5.4, lng: 100.3, label: "Other user's stop",
    }, createDb({ trips: [{ ...ownedTrip, user_id: OTHER_USER_ID }] }).client)).rejects.toThrow("Trip not found");
  });

  it("accepts PostgreSQL UUID identifiers outside the RFC version-bit range", async () => {
    const catalogueProductId = "a54fe0fb-042c-e2e4-9dde-c18a8444cb8e";
    const { client, database } = createDb({ trips: [ownedTrip] });

    const item = await addTripItem({
      trip_id: TRIP_ID, experience_id: catalogueProductId, source: "vendor", lat: 3.14, lng: 101.69,
      label: "Catalogue activity",
    }, client);

    expect(item.experience_id).toBe(catalogueProductId);
    expect(database.trip_items).toContainEqual(expect.objectContaining({ experience_id: catalogueProductId }));
  });

  it("rejects a scheduled stop outside its trip before inserting", async () => {
    const { client, database } = createDb({ trips: [ownedTrip] });

    await expect(addTripItem({
      trip_id: TRIP_ID, experience_id: PRODUCT_ID, source: "vendor", lat: 5.4, lng: 100.3,
      label: "Outside", scheduled_date: "2026-09-18",
    }, client)).rejects.toThrow("Scheduled date is outside this trip");
    expect(database.trip_items).toEqual([]);
  });

  it("rejects a time-reversing reorder and persists valid ordering", async () => {
    const { client, database } = createDb({
      trips: [ownedTrip],
      trip_items: [
        { id: "first", trip_id: TRIP_ID, experience_id: PRODUCT_ID, sequence: 0, scheduled_date: "2026-09-16", scheduled_time: "10:00", created_at: NOW, source: "vendor", kind: null, lat: 5.4, lng: 100.3, label: "First", sublabel: null },
        { id: "second", trip_id: TRIP_ID, experience_id: PRODUCT_ID, sequence: 1, scheduled_date: "2026-09-16", scheduled_time: "11:00", created_at: NOW, source: "vendor", kind: null, lat: 5.4, lng: 100.3, label: "Second", sublabel: null },
      ],
    });

    await expect(reorderTripItems(TRIP_ID, ["second", "first"], client)).rejects.toThrow("Trip times must follow itinerary order");
    await expect(reorderTripItems(TRIP_ID, ["first"], client)).rejects.toThrow("Trip items changed; refresh and try again");
    await reorderTripItems(TRIP_ID, ["first", "second"], client);

    expect(database.trip_items.map((item) => item.sequence)).toEqual([0, 1]);
  });

  it("rejects an unauthenticated read and keeps edits scoped to owned stops", async () => {
    await expect(getTrips(createDb({}, null).client)).rejects.toThrow("Authentication required");
    const { client, database } = createDb({
      trips: [{ ...ownedTrip, user_id: OTHER_USER_ID }],
      trip_items: [{ id: "foreign-item", trip_id: TRIP_ID, experience_id: null, sequence: 0, scheduled_date: null, scheduled_time: null, created_at: NOW, source: "location", kind: "custom", lat: 5.4, lng: 100.3, label: "Private", sublabel: null }],
    });
    await expect(updateTripItem("foreign-item", { scheduled_time: "09:00" }, client)).rejects.toThrow("Trip not found");
    expect(database.trip_items[0]?.scheduled_time).toBeNull();
    expect(await getTripById(TRIP_ID, client)).toBeNull();
  });
});
