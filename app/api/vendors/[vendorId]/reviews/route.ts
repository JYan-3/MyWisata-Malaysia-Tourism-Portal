import { getReviewRatingSummary, getScopedReviewPage } from "@/backend/domains/vendor-reviews";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { apiFail, apiOk } from "@/lib/validation/schemas";

interface Props {
  params: Promise<{ vendorId: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function queryInteger(value: string | null, fallback: number): number {
  return value === null || value.trim() === "" ? fallback : Number(value);
}

export async function GET(request: Request, { params }: Props) {
  const { vendorId } = await params;
  if (!UUID.test(vendorId)) return apiFail("INVALID_VENDOR", "vendorId must be a valid UUID", 400);

  const query = new URL(request.url).searchParams;
  const page = queryInteger(query.get("page"), 1);
  const pageSize = queryInteger(query.get("pageSize"), 6);
  const ratingParam = query.get("rating");
  const rating = ratingParam === null ? undefined : Number(ratingParam);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10) {
    return apiFail("INVALID_QUERY", "page must be positive and pageSize must be between 1 and 10", 400);
  }
  if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return apiFail("INVALID_QUERY", "rating must be an integer between 1 and 5", 400);
  }

  try {
    const db = await createClient();
    const { data: vendor, error: vendorError } = await db
      .from("vendors")
      .select("id")
      .eq("id", vendorId)
      .eq("status", "approved")
      .maybeSingle();
    if (vendorError) return apiFail("DB_ERROR", vendorError.message, 500);
    if (!vendor) return apiFail("NOT_FOUND", "Vendor not found", 404);

    const [reviews, summary] = await Promise.all([
      getScopedReviewPage("vendor", vendorId, { page, pageSize, rating }, db),
      getReviewRatingSummary("vendor", vendorId, createServiceClient()),
    ]);
    return apiOk({ ...reviews, ratingBuckets: summary.buckets });
  } catch (error) {
    return apiFail("DB_ERROR", error instanceof Error ? error.message : "Could not load vendor reviews", 500);
  }
}
