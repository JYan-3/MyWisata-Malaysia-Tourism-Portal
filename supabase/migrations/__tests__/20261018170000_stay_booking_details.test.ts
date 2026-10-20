import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261018170000_stay_booking_details.sql"), "utf8");

describe("hotel stay booking details migration", () => {
  it("adds only an object-shaped JSON snapshot to orders", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS stay_details JSONB NOT NULL DEFAULT '{}'::jsonb");
    expect(sql).toContain("CHECK (jsonb_typeof(stay_details) = 'object')");
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+public\.orders\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it("keeps the order snapshot inside the existing atomic checkout transaction", () => {
    expect(sql).toContain("public.checkout_transaction_core(uuid,uuid[],text,text,text,numeric,numeric,numeric,text,jsonb,uuid,uuid,jsonb)");
    expect(sql).toContain("COALESCE(p_contact->'stay_details', '{}'::jsonb)");
    expect(sql).toContain("checkout_transaction_core order insert changed");
  });

  it("includes stay preferences in account checkout retry equality", () => {
    expect(sql).toContain("stay_details IS NOT DISTINCT FROM COALESCE(p_contact->'stay_details', '{}'::jsonb)");
    expect(sql).toContain("apply_account_checkout_contact changed");
  });
});
