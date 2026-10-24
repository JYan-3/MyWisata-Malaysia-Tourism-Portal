import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export function reviewQueueQuery(request: Request, domain: "registrations" | "promotions" | "refunds") {
  const statuses = domain === "refunds" ? ["pending", "approved", "processed", "rejected", "failed"]
    : domain === "promotions" ? ["pending", "approved", "paid", "rejected", "changes_requested", "paused"]
    : ["pending", "approved", "rejected", "changes_requested", "withdrawn", "removed"];
  return z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().refine((size) => (domain === "refunds" ? [15,25,50] : [10,25,50]).includes(size)).default(domain === "refunds" ? 15 : 10),
    status: z.string().refine((status) => statuses.includes(status)).optional(),
    search: z.string().max(200).default(""),
  }).safeParse(Object.fromEntries(new URL(request.url).searchParams));
}

export async function readReviewQueue(db: SupabaseClient, domain: "registrations" | "promotions" | "refunds", filters: { page: number; pageSize: number; status?: string; search: string }) {
  return db.rpc("list_staff_review_queue", { p_domain: domain, p_page: filters.page, p_page_size: filters.pageSize, p_status: filters.status ?? null, p_search: filters.search });
}
