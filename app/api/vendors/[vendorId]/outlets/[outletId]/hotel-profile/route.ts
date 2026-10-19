import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { hotelProfileSchema } from '@/lib/validation/vendor-schemas';
import { authorizeOutlet, type VendorAccess } from '@/lib/vendor-authorization';
import { isHotelOutlet } from '@/lib/customer/hotel-outlet';
import { getPendingHotelProfile, isManagedHotelPhoto, loadLiveHotelProfile, upsertPendingHotelProfile } from '@/lib/vendor/hotel-profile';

interface Props { params: Promise<{ vendorId: string; outletId: string }> }

async function hotelAccess(vendorId: string, outletId: string): Promise<{ error: Response } | { access: VendorAccess }> {
  const result = await authorizeOutlet(vendorId, outletId);
  if (!result.ok) return { error: result.response };
  if (!await isHotelOutlet(result.access.serviceDb, outletId)) {
    return { error: apiFail('NOT_A_HOTEL', 'Hotel profiles are only for outlets that sell rooms', 409) };
  }
  return { access: result.access };
}

export async function GET(_request: Request, { params }: Props) {
  const { vendorId, outletId } = await params;
  const auth = await hotelAccess(vendorId, outletId);
  if ('error' in auth) return auth.error;
  const db = auth.access.serviceDb;
  const [live, pending, { data: latest }, { data: amenities }] = await Promise.all([
    loadLiveHotelProfile(db, outletId),
    getPendingHotelProfile(db, outletId),
    db.from('hotel_profile_submissions').select('status,review_note,reviewed_at').eq('outlet_id', outletId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('hotel_amenities').select('code,label_en,label_ms,label_zh,icon').eq('is_active', true).order('sort_order'),
  ]);
  // Amenities an admin has since retired are dropped, so the vendor is never stuck on a code they cannot untick.
  const activeCodes = new Set((amenities ?? []).map((row: { code: string }) => row.code));
  const withActiveCodes = <T extends { amenityCodes: string[] }>(profile: T): T => ({ ...profile, amenityCodes: profile.amenityCodes.filter((code) => activeCodes.has(code)) });
  return apiOk({
    isHotel: true,
    live: withActiveCodes(live),
    pending: pending ? withActiveCodes(pending.payload) : null,
    lastRejection: latest?.status === 'rejected' ? { note: latest.review_note, reviewedAt: latest.reviewed_at } : null,
    amenities: amenities ?? [],
  });
}

export async function POST(request: Request, { params }: Props) {
  const { vendorId, outletId } = await params;
  const auth = await hotelAccess(vendorId, outletId);
  if ('error' in auth) return auth.error;
  const parsed = await parseBody(request, hotelProfileSchema);
  if (!parsed.ok) return parsed.response;
  const profile = parsed.data;
  const db = auth.access.serviceDb;

  const { data: amenities } = await db.from('hotel_amenities').select('code').eq('is_active', true);
  const activeCodes = new Set((amenities ?? []).map((row: { code: string }) => row.code));
  if (profile.amenityCodes.some((code) => !activeCodes.has(code))) {
    return apiFail('UNKNOWN_AMENITY', 'Choose amenities from the list', 422);
  }

  const live = await loadLiveHotelProfile(db, outletId);
  if (profile.photos.some((url) => !live.photos.includes(url) && !isManagedHotelPhoto(url, vendorId, outletId))) {
    return apiFail('INVALID_PHOTO', 'Upload photos through the hotel profile', 422);
  }

  const submission = await upsertPendingHotelProfile(db, { outletId, vendorId, userId: auth.access.userId, profile });
  return apiOk({ submissionId: submission.id, pendingReview: true });
}
