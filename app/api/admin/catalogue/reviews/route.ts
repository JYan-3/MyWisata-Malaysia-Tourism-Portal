import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { contentReviewSchema } from '@/lib/validation/vendor-schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { emitVendorNotification } from '@/lib/vendor-notifications/emit';
import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const queueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().refine((value) => value === 10 || value === 25 || value === 50).default(10),
  entityType: z.enum(['outlet', 'product', 'voucher', 'hotel_profile']).optional(),
});

async function requireCatalogueReview(): Promise<{ error: Response } | { db: SupabaseClient; serviceDb: ReturnType<typeof createServiceClient> }> {
  const auth = await requireStaffPermission("admin.catalogue.review");
  if (auth.response) return { error: auth.response };
  if (!auth.user) return { error: apiFail('UNAUTHORIZED', 'Sign in required', 401) };
  return { db: auth.db, serviceDb: createServiceClient() };
}

export async function GET(request: Request) {
  const auth = await requireCatalogueReview();
  if ('error' in auth) return auth.error;
  const { serviceDb: db } = auth;
  const parsed = queueQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiFail('VALIDATION_FAILED', 'Invalid catalogue queue filters', 422, parsed.error.flatten());
  const { page, pageSize, entityType } = parsed.data;
  const { data, error } = await db.rpc('list_catalogue_review_queue', {
    p_page: page,
    p_page_size: pageSize,
    p_entity_type: entityType ?? null,
  });
  if (error) return apiFail('DB_ERROR', 'Unable to load the catalogue review queue', 500);
  return apiOk(data);
}

export async function POST(request: Request) {
  const auth = await requireCatalogueReview();
  if ('error' in auth) return auth.error;
  const { db, serviceDb } = auth;
  const parsed = await parseBody(request, contentReviewSchema);
  if (!parsed.ok) return parsed.response;
  const { entityType, entityId, action, note, expectedVersion } = parsed.data;

  const { data, error } = await db.rpc('review_catalogue_item', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_expected_updated_at: expectedVersion,
    p_action: action,
    p_note: note ?? null,
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('catalogue_item_not_found')) return apiFail('NOT_FOUND', 'Review item not found', 404);
    if (message.includes('permission_required')) return apiFail('FORBIDDEN', 'Catalogue review permission required', 403);
    if (message.includes('catalogue_item_changed') || message.includes('catalogue_item_not_pending') || message.includes('voucher_vendor_owner_approval_required')) {
      return apiFail('REVIEW_CONFLICT', 'Another reviewer or the vendor changed this item. Reload it and review the current version.', 409);
    }
    if (message.includes('expected_version_required')) return apiFail('VERSION_REQUIRED', 'Reload the review queue before deciding on this item', 422);
    console.error('[catalogue-review] transaction failed', { entityType, entityId, error: message });
    return apiFail('DB_ERROR', 'Unable to complete the review. No review decision was committed.', 500);
  }

  const receipt = data as { reviewId: string; entityId: string; entityType: string; status: string; reviewedBy: string; reviewedAt: string; vendorId: string | null };
  if (!receipt?.reviewId) return apiFail('DB_ERROR', 'Review transaction returned no receipt', 500);
  if (entityType === 'hotel_profile' || entityType === 'product') revalidateTag('activities', { expire: 0 });

  if (receipt.vendorId) {
    try {
      await emitVendorNotification({
        eventKey: `listing:review:${receipt.reviewId}`,
        vendorId: receipt.vendorId,
        audience: 'owner',
        category: 'vendor_products',
        type: `vendor_listing_${action}`,
        title: `Listing ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'changes requested'}`,
        body: note ? `Your ${entityType} review was ${action === 'change_requested' ? 'returned for changes' : `${action}ed`}: ${note}` : `Your ${entityType} review was ${action === 'change_requested' ? 'returned for changes' : `${action}ed`}.`,
        link: entityType === 'hotel_profile' || entityType === 'outlet' ? '/vendor/outlets' : '/vendor/products',
        email: true,
        reference: entityId,
        metadata: { entityType, status: receipt.status, reviewId: receipt.reviewId },
        serviceDb,
      });
    } catch (notificationError) {
      console.error('[vendor-notifications] committed catalogue review notice delivery failed', { reviewId: receipt.reviewId, entityType, entityId, error: notificationError });
    }
  }

  return apiOk({ ...receipt, id: entityId, review_status: receipt.status });
}
