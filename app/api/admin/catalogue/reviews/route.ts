import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { contentReviewSchema } from '@/lib/validation/vendor-schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { auditAndNotify } from '@/lib/audit';
import { emitVendorNotification } from '@/lib/vendor-notifications/emit';
import { getSuperAdminReviewUpdate } from '@/lib/vendor/voucher-review';
import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { revalidateTag } from 'next/cache';

async function requireCatalogueReview(): Promise<{ error: Response } | { db: ReturnType<typeof createServiceClient>; user: { id: string } }> {
  const auth = await requireStaffPermission("admin.catalogue.review");
  if (auth.response) return { error: auth.response };
  if (!auth.user) return { error: apiFail('UNAUTHORIZED', 'Sign in required', 401) };
  return { db: createServiceClient(), user: auth.user };
}

export async function GET() {
  const auth = await requireCatalogueReview();
  if ('error' in auth) return auth.error;
  const { db } = auth;
  const [outlets, products, vouchers, hotelProfiles] = await Promise.all([
    db.from('outlets').select('id,display_id,name,city,state,review_status,review_note,created_at,vendor_id,vendors(name)').eq('review_status', 'pending_review').order('created_at', { ascending: false }),
    db.from('products').select('id,display_id,name,product_type,base_price,review_status,review_note,created_at,vendor_id,vendors(name),outlets(name,city)').eq('review_status', 'pending_review').order('created_at', { ascending: false }),
    db.from('vouchers').select('id,code,name,discount_value,voucher_type,review_status,review_note,vendor_review_status,created_at,vendor_id,vendors(name),outlets(name,city)').eq('review_status', 'pending_review').order('created_at', { ascending: false }),
    db.from('hotel_profile_submissions').select('id,created_at,updated_at,vendor_id,outlet_id,payload,vendors(name),outlets(name,city,state,address,phone,hotel_about,amenity_codes,check_in_time,check_out_time,stay_policies)').eq('status', 'pending_review').order('created_at', { ascending: false }),
  ]);
  const failed = [outlets, products, vouchers, hotelProfiles].find((result) => result.error);
  if (failed?.error) return apiFail('DB_ERROR', failed.error.message, 500);
  return apiOk({
    items: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(outlets.data ?? []).map((item: any) => ({ ...item, entityType: 'outlet', entityLabel: item.name, context: [item.city, item.state].filter(Boolean).join(', ') })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(products.data ?? []).map((item: any) => ({ ...item, entityType: 'product', entityLabel: item.name, context: item.outlets?.city || item.outlets?.name || item.product_type })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(hotelProfiles.data ?? []).map((item: any) => ({ ...item, review_status: 'pending_review', entityType: 'hotel_profile', entityLabel: item.outlets?.name ?? 'Hotel', context: [item.outlets?.city, item.outlets?.state].filter(Boolean).join(', '), live: item.outlets ?? null, proposed: item.payload })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(vouchers.data ?? []).filter((item: any) => item.vendor_review_status === 'approved').map((item: any) => ({ ...item, entityType: 'voucher', entityLabel: `${item.code} · ${item.name}`, context: item.outlets?.city || 'All outlets' })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  });
}

export async function POST(request: Request) {
  const auth = await requireCatalogueReview();
  if ('error' in auth) return auth.error;
  const { db, user } = auth;
  const parsed = await parseBody(request, contentReviewSchema);
  if (!parsed.ok) return parsed.response;
  const { entityType, entityId, action, note, expectedVersion } = parsed.data;

  // Hotel profiles (D4): approval applies the submission atomically; the hotel is never taken offline.
  if (entityType === 'hotel_profile') {
    const { data: submission } = await db.from('hotel_profile_submissions').select('id,outlet_id,vendor_id,status,payload,outlets(name)').eq('id', entityId).maybeSingle();
    if (!submission) return apiFail('NOT_FOUND', 'Review item not found', 404);
    if (submission.status !== 'pending_review') return apiFail('INVALID_STATE', 'This item is no longer waiting for review', 409);
    if (!expectedVersion) return apiFail('VERSION_REQUIRED', 'Reload the review queue before deciding on this hotel profile', 422);
    const stale = () => apiFail('STALE_SUBMISSION', 'The hotel changed this profile while you were reviewing it. Reload to see the latest version.', 409);
    const reviewStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action;
    if (action === 'approve') {
      const { error } = await db.rpc('apply_hotel_profile_submission', { p_submission_id: entityId, p_reviewer: user.id, p_expected_updated_at: expectedVersion });
      if (error?.message?.includes('hotel_profile_submission_changed') || error?.message?.includes('hotel_profile_submission_not_pending')) return stale();
      if (error) return apiFail('DB_ERROR', error.message, 500);
      revalidateTag('activities', { expire: 0 });
    } else {
      const { data: rejected, error } = await db.from('hotel_profile_submissions')
        .update({ status: 'rejected', review_note: note ?? null, reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', entityId).eq('status', 'pending_review').eq('updated_at', expectedVersion).select('id').maybeSingle();
      if (error) return apiFail('DB_ERROR', error.message, 500);
      if (!rejected) return stale();
    }
    const recorded = await recordReview(db, { entityType, entityId, vendorId: submission.vendor_id, reviewerId: user.id, action, reviewStatus, note, link: '/vendor/outlets' });
    if (recorded) return recorded;
    return apiOk({ id: entityId, status: reviewStatus === 'approved' ? 'approved' : 'rejected' });
  }

  const table = entityType === 'outlet' ? 'outlets' : entityType === 'product' ? 'products' : 'vouchers';
  const { data: entity, error: entityError } = await db.from(table).select('*').eq('id', entityId).single();
  if (entityError || !entity) return apiFail('NOT_FOUND', 'Review item not found', 404);
  if (entity.review_status !== 'pending_review') return apiFail('INVALID_STATE', 'This item is no longer waiting for review', 409);
  if (entityType === 'voucher' && entity.vendor_review_status !== 'approved') return apiFail('INVALID_STATE', 'This voucher must be approved by the Vendor Owner first', 409);

  const reviewStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action;
  const update = entityType === 'voucher'
    ? { ...getSuperAdminReviewUpdate({ action, reviewerId: user.id, note }), reviewed_at: new Date().toISOString() }
    : { review_status: reviewStatus, review_note: note ?? null, reviewed_by: user.id, reviewed_at: new Date().toISOString(), status: action === 'approve' ? 'active' : 'inactive' };
  const { data: updated, error: updateError } = await db.from(table).update(update).eq('id', entityId).select().single();
  if (updateError) return apiFail('DB_ERROR', updateError.message, 500);
  if (entityType === 'product') revalidateTag('activities', { expire: 0 });

  const recorded = await recordReview(db, { entityType, entityId, vendorId: entity.vendor_id, reviewerId: user.id, action, reviewStatus, note, link: '/vendor/products', beforeStatus: entity.review_status });
  if (recorded) return recorded;
  return apiOk(updated);
}

/** Review history, audit and vendor notification shared by every reviewed entity. Returns a response only on failure. */
async function recordReview(
  db: ReturnType<typeof createServiceClient>,
  input: { entityType: string; entityId: string; vendorId: string | null; reviewerId: string; action: string; reviewStatus: string; note?: string; link: string; beforeStatus?: string },
): Promise<Response | null> {
  const { entityType, entityId, vendorId, reviewerId, action, reviewStatus, note, link } = input;
  const { error: reviewHistoryError } = await db.from('content_reviews').insert({ entity_type: entityType, entity_id: entityId, vendor_id: vendorId, reviewer_id: reviewerId, action: reviewStatus, note: note ?? null });
  if (reviewHistoryError) {
    console.error('[catalogue-review] failed to record review history', reviewHistoryError);
    return apiFail('DB_ERROR', 'The review state changed, but the review history could not be recorded', 500);
  }
  await auditAndNotify({ action: `content.${action}`, entityType, entityId, beforeData: { review_status: input.beforeStatus ?? 'pending_review' }, afterData: { review_status: reviewStatus }, note });
  if (vendorId) {
    void emitVendorNotification({
      eventKey: `listing:review:${entityType}:${entityId}:${action}`,
      vendorId,
      audience: 'owner',
      category: 'vendor_products',
      type: `vendor_listing_${action}`,
      title: `Listing ${action === 'approve' ? 'approved' : 'rejected'}`,
      body: note ? `Your ${entityType} review was ${action}ed: ${note}` : `Your ${entityType} review was ${action}ed.`,
      link,
      email: true,
      reference: entityId,
      metadata: { entityType, status: reviewStatus },
      serviceDb: db,
    }).catch((notificationError) => console.error('[vendor-notifications] listing review event failed', notificationError));
  }
  return null;
}
