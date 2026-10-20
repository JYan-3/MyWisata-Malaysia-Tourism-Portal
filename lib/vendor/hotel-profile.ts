import type { SupabaseClient } from '@supabase/supabase-js';
import type { HotelProfile } from '@/lib/validation/vendor-schemas';

export type { HotelProfile };

const HOTEL_PHOTO_MARKER = '/storage/v1/object/public/vendor-products/';

/** Storage path prefix for a hotel's uploaded profile photos. */
export function hotelPhotoPath(vendorId: string, outletId: string) {
  return `${vendorId}/hotel/${outletId}/`;
}

/** True only for photos uploaded through this hotel's photo route. */
export function isManagedHotelPhoto(url: string, vendorId: string, outletId: string): boolean {
  const index = url.indexOf(HOTEL_PHOTO_MARKER);
  if (index < 0) return false;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(index + HOTEL_PHOTO_MARKER.length));
  } catch {
    return false;
  }
  if (path.includes('..') || path.includes('\\')) return false;
  const prefix = hotelPhotoPath(vendorId, outletId);
  return path.startsWith(prefix) && /^[^/]+\.(?:jpg|png|webp)$/i.test(path.slice(prefix.length));
}

/** The profile customers see now: live outlet columns plus the outlet gallery. */
export async function loadLiveHotelProfile(db: SupabaseClient, outletId: string): Promise<HotelProfile> {
  const [{ data: outlet, error: outletError }, { data: media, error: mediaError }] = await Promise.all([
    db.from('outlets').select('name,address,city,state,postcode,country,phone,email,lat,lng,hotel_about,amenity_codes,check_in_time,check_out_time,stay_policies').eq('id', outletId).maybeSingle(),
    db.from('media_assets').select('url,sort_order').eq('outlet_id', outletId).is('product_id', null).order('sort_order'),
  ]);
  // A failed read must never become an empty profile: approving it would wipe the live hotel.
  if (outletError || mediaError) throw new Error((outletError ?? mediaError)!.message);
  return {
    about: outlet?.hotel_about ?? '',
    amenityCodes: outlet?.amenity_codes ?? [],
    checkInTime: outlet?.check_in_time?.slice(0, 5) ?? '15:00',
    checkOutTime: outlet?.check_out_time?.slice(0, 5) ?? '12:00',
    policies: outlet?.stay_policies ?? '',
    photos: (media ?? []).filter((row) => row.sort_order !== -1).map((row) => row.url),
    name: outlet?.name ?? undefined,
    address: outlet?.address ?? undefined,
    city: outlet?.city ?? undefined,
    state: outlet?.state ?? undefined,
    postcode: outlet?.postcode ?? undefined,
    phone: outlet?.phone ?? undefined,
    country: outlet?.country ?? undefined,
    email: outlet?.email ?? undefined,
    lat: typeof outlet?.lat === 'number' ? outlet.lat : undefined,
    lng: typeof outlet?.lng === 'number' ? outlet.lng : undefined,
  };
}

/** The single pending submission for an outlet, if any. */
export async function getPendingHotelProfile(db: SupabaseClient, outletId: string): Promise<{ id: string; payload: HotelProfile } | null> {
  const { data, error } = await db.from('hotel_profile_submissions').select('id,payload').eq('outlet_id', outletId).eq('status', 'pending_review').maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id, payload: data.payload as HotelProfile } : null;
}

/**
 * Saves a profile for admin review (D4). Replaces the outlet's one pending submission or creates it.
 * Never writes the live outlet, so the hotel stays listed while the edit waits.
 */
export async function upsertPendingHotelProfile(
  db: SupabaseClient,
  input: { outletId: string; vendorId: string; userId: string; profile: HotelProfile },
): Promise<{ id: string; created: boolean }> {
  const { data: pending } = await db.from('hotel_profile_submissions').select('id').eq('outlet_id', input.outletId).eq('status', 'pending_review').maybeSingle();
  if (pending) {
    const { error } = await db.from('hotel_profile_submissions')
      .update({ payload: input.profile, submitted_by: input.userId, updated_at: new Date().toISOString() })
      .eq('id', pending.id).eq('status', 'pending_review').select('id').single();
    if (error) throw new Error(error.message);
    return { id: pending.id, created: false };
  }
  const { data, error } = await db.from('hotel_profile_submissions')
    .insert({ outlet_id: input.outletId, vendor_id: input.vendorId, submitted_by: input.userId, status: 'pending_review', payload: input.profile })
    .select('id').single();
  if (error) throw new Error(error.message);
  return { id: data.id, created: true };
}
