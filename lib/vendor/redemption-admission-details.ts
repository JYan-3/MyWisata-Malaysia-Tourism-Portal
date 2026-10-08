import type { TicketEntryPolicy } from "@/lib/tickets/product-ticket-policy";

export function formatTicketAdmissionDetails(policy: TicketEntryPolicy | null | undefined, admittedCount: unknown): string {
  const count = typeof admittedCount === "number" && Number.isSafeInteger(admittedCount)
    ? admittedCount
    : 0;
  if (count < 1) return "Admission count unavailable";

  if (policy === "group_entry") {
    return `Admitted: ${count} ${count === 1 ? "guest" : "guests"}`;
  }
  if (policy === "multi_entry") {
    return `${count} ${count === 1 ? "visit" : "visits"} used`;
  }
  if (policy === "single_entry") {
    return `Admitted: ${count} ${count === 1 ? "entry" : "entries"}`;
  }
  return `${count} ${count === 1 ? "admission" : "admissions"} recorded`;
}
