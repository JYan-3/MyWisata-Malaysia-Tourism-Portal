import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
const sql=readFileSync("supabase/migrations/20261021055834_trip_day_origins.sql","utf8");
it("adds an opt-in daily origin with one location per owned trip day",()=>{
  expect(sql).toMatch(/is_day_origin boolean NOT NULL DEFAULT false/i);
  expect(sql).toMatch(/source = 'location'/);
  expect(sql).toMatch(/experience_id IS NULL/);
  expect(sql).toMatch(/scheduled_date IS NOT NULL/);
  expect(sql).toMatch(/UNIQUE INDEX[\s\S]*\(trip_id, scheduled_date\)[\s\S]*WHERE is_day_origin/i);
  expect(sql).not.toMatch(/DROP POLICY|GRANT|UPDATE public.trip_items|DELETE FROM/i);
});
