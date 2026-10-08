import { describe, expect, it } from "vitest";
import { formatTicketAdmissionDetails } from "@/lib/vendor/redemption-admission-details";

describe("ticket redemption admission details", () => {
  it("reports a single-entry pass as entries", () => {
    expect(formatTicketAdmissionDetails("single_entry", 1)).toBe("Admitted: 1 entry");
  });

  it("reports group admissions as guests", () => {
    expect(formatTicketAdmissionDetails("group_entry", 3)).toBe("Admitted: 3 guests");
  });

  it("reports multi-entry admissions as visits", () => {
    expect(formatTicketAdmissionDetails("multi_entry", 1)).toBe("1 visit used");
    expect(formatTicketAdmissionDetails("multi_entry", 3)).toBe("3 visits used");
  });

  it("does not invent an admission count when the audit row is invalid", () => {
    expect(formatTicketAdmissionDetails("group_entry", 0)).toBe("Admission count unavailable");
    expect(formatTicketAdmissionDetails("single_entry", Number.NaN)).toBe("Admission count unavailable");
  });

  it("reports a generic admission when a legacy audit row has no ticket policy", () => {
    expect(formatTicketAdmissionDetails(undefined, 2)).toBe("2 admissions recorded");
  });
});
