import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../20261023130642_wallet_approver_notification_jobs.sql", import.meta.url), "utf8");

describe("Wallet Approver notification jobs migration", () => {
  it("replaces the legacy synchronous fan-out with a durable status-triggered queue", () => {
    expect(migration).toContain("DROP TRIGGER IF EXISTS withdrawal_approver_notification ON public.withdrawal_requests");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.notify_withdrawal_approvers()");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF status, approval_cycle ON public.withdrawal_requests");
    expect(migration).toContain("ON CONFLICT DO NOTHING");
    expect(migration).toContain("WHERE status IN ('pending', 'pending_second_approval')");
  });

  it("restricts the private worker queue and RPC wrappers to service_role", () => {
    expect(migration).toContain("ALTER TABLE app_private.withdrawal_approver_jobs ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON app_private.withdrawal_approver_jobs FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("AND public.has_staff_permission(users.id, 'admin.withdrawal.approve')");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.withdrawal_approver_recipients(uuid, uuid) FROM PUBLIC, anon, authenticated");
    expect(migration).not.toContain("portal_workload_slots");
    expect(migration).not.toContain("recommendation_images");
    expect(migration).not.toContain("trip_ai");
  });
});
