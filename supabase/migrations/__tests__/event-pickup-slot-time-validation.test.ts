import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migrationName = readdirSync(migrationsDirectory).find((name) => name.endsWith("_event_pickup_slot_time_validation.sql"));
const sql = migrationName ? readFileSync(resolve(migrationsDirectory, migrationName), "utf8") : "";

describe("event pickup slot time validation migration", () => {
  it("replaces the date-only RPC with a slot-aware signature and removes the old callable overload", () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.fulfil_event_pickup\(UUID, UUID, UUID, DATE, UUID\)/i);
    expect(sql).toMatch(/CREATE FUNCTION public\.fulfil_event_pickup\([\s\S]*?p_pickup_date DATE,[\s\S]*?p_pickup_slot_id UUID,[\s\S]*?p_operator_id UUID/i);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.fulfil_event_pickup(UUID, UUID, UUID, DATE, UUID, UUID) TO service_role");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
  });

  it("checks saved slot snapshots before updating only the slot covered by the QR", () => {
    expect(sql).toContain("slot_starts_at IS NULL");
    expect(sql).toContain("slot_starts_at > v_now");
    expect(sql).toContain("RAISE EXCEPTION 'event_pickup_not_yet'");
    expect(sql).toContain("RAISE EXCEPTION 'event_pickup_time_unavailable'");
    expect(sql).toContain("AND (p_pickup_slot_id IS NULL OR pickup_slot_id = p_pickup_slot_id)");
    expect(sql).toContain("'pickup_slot_id', p_pickup_slot_id");
    expect(sql).toContain("'pickup_times', v_pickup_times");
    expect(sql).toContain("'item_details', v_item_details");
    expect(sql).toContain("'event_pickup.fulfilled'");
    expect(sql.indexOf("FOR UPDATE;")).toBeLessThan(sql.indexOf("v_now := clock_timestamp()"));
  });
});
