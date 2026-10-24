import { getReviewRatingSummary, getScopedReviewPage } from "@/backend/domains/vendor-reviews";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { apiFail, apiOk } from "@/lib/validation/schemas";

interface Props {
  params: Promise<{ outletId: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function queryInteger(value: string | null, fallback: number): number {
  return value === null || value.trim() === "" ? fallback : Number(value);
}

export async function GET(request: Request, { params }: Props) {
  const { outletId } = await params;
  if (!UUID.test(outletId)) return apiFail("INVALID_OUTLET", "outletId must be a valid UUID", 400);

  const query = new URL(request.url).searchParams;
  const page = queryInteger(query.get("page"), 1);
  const pageSize = queryInteger(query.get("pageSize"), 6);
  const ratingParam = query.get("rating");
  const rating = ratingParam === null ? undefined : Number(ratingParam);
  const category = query.get("category");
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10) {
    return apiFail("INVALID_QUERY", "page must be positive and pageSize must be between 1 and 10", 400);
  }
  if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return apiFail("INVALID_QUERY", "rating must be an integer between 1 and 5", 400);
  }
  if (category !== null && category !== "accommodation") {
    return apiFail("INVALID_QUERY", "category must be accommodation when provided", 400);
  }

  try {
    const db = await createClient();
    const { data: outlet, error: outletError } = await db
      .from("outlets")
      .select("id")
      .eq("id", outletId)
      .eq("status", "active")
      .eq("review_status", "approved")
      .maybeSingle();
    if (outletError) return apiFail("DB_ERROR", outletError.message, 500);
    if (!outlet) return apiFail("NOT_FOUND", "Outlet not found", 404);

    const [reviews, summary] = await Promise.all([
      getScopedReviewPage("outlet", outletId, { page, pageSize, rating, productCategorySlug: category ?? undefined }, db),
      getReviewRatingSummary(category === "accommodation" ? "outlet_accommodation" : "outlet", outletId, createServiceClient()),
    ]);
    return apiOk({ ...reviews, ratingBuckets: summary.buckets });
  } catch (error) {
    return apiFail("DB_ERROR", error instanceof Error ? error.message : "Could not load outlet reviews", 500);
  }
}
