import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../20261016021843_guest_rate_limit_cleanup.sql", import.meta.url), "utf8");

describe("guest rate limit cleanup migration", () => {
  it("uses an indexed, bounded service-only purge for windows older than the maximum accepted window", () => {
    expect(sql).toMatch(/CREATE INDEX[^;]+guest_rate_limits_window_started_at_idx[^;]+window_started_at/i);
    expect(sql).toContain("window_started_at < now() - interval '24 hours'");
    expect(sql).toMatch(/LIMIT p_batch_size[\s\S]*?FOR UPDATE SKIP LOCKED/i);
    expect(sql).toContain("p_batch_size NOT BETWEEN 1 AND 1000");
    expect(sql).toContain("p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.purge_expired_guest_rate_limits(integer) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.purge_expired_guest_rate_limits(integer) TO service_role");
  });
});
