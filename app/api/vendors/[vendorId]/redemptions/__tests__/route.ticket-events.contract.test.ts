import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "app/api/vendors/[vendorId]/redemptions/route.ts"),
  "utf8",
);

describe("ticket redemption event projection", () => {
  it("reads immutable scan events and uses admitted entries for ticket history", () => {
    expect(routeSource).toContain("from('check_in_events')");
    expect(routeSource).toContain("entries_admitted");
    expect(routeSource).toContain("formatTicketAdmissionDetails");
    expect(routeSource).toContain("ticketAdmissions +=");
    expect(routeSource).toContain("ticketCount: ticketAdmissions");
    expect(routeSource).toContain("!bookingsWithEvents.has(row.id)");
    expect(routeSource).not.toContain("details: `Admitted: ${orderItem?.quantity || 1} guest(s)`");
  });
});
