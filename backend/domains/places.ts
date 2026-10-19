// Places domain — Penang place-first navigation (state > region > poi).
// See docs/plans/2026-08-12-2152-penang-place-model-and-data-reset.md §4.
// Reuses catalogue.ts's ID-scoped Activity/vendor mappers instead of
// duplicating their query/mapping logic. Place products keep their own
// place-specific relation mapping rather than using outlet-collapsed search.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/backend/supabase";
import { haversineKm } from "@/backend/core/helpers";
import type { Outlet, Place, PlaceAccess, PlaceAccessType, PlaceInformationalActivity, PlaceInformationalActivityType, PlaceLevel, PlaceProduct, PlaceRelation } from "@/backend/core/types";
import { getActivitiesByIds, getOutlets, getVendors } from "@/backend/domains/catalogue";
import { selectEntityGallery, type EntityMediaRow } from "@/lib/customer/entity-media";
import { placeImageUrl } from "@/lib/storage/place-image";

type PlaceRow = {
  id: string;
  parent_id: string | null;
  level: PlaceLevel;
  name: string;
  slug: string;
  tagline: string | null;
  intro: string | null;
  image_url: string | null;
  state: string;
  district: string | null;
  lat: number | string;
  lng: number | string;
  entry_fee: number | string | null;
  managed_by_vendor_id: string | null;
  detail: Place["detail"];
};

const PLACES_SELECT =
  "id,parent_id,level,name,slug,tagline,intro,image_url,state,district,lat,lng,entry_fee,managed_by_vendor_id,detail";

// PostgREST serialises NUMERIC as a string — coerce every numeric column,
// same convention as mapActivity()'s place_lat/place_lng handling.
function mapPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    parentId: row.parent_id,
    level: row.level as Place["level"],
    name: row.name,
    slug: row.slug,
    tagline: row.tagline,
    intro: row.intro,
    imageUrl: placeImageUrl(row.image_url),
    state: row.state,
    district: row.district,
    lat: Number(row.lat),
    lng: Number(row.lng),
    entryFee: row.entry_fee === null ? null : Number(row.entry_fee),
    managedByVendorId: row.managed_by_vendor_id,
    detail: row.detail,
  };
}

export async function getPlaceBySlug(slug: string, db: SupabaseClient = supabase): Promise<Place | null> {
  const { data, error } = await db
    .from("places")
    .select(PLACES_SELECT)
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data ? mapPlace(data as unknown as PlaceRow) : null;
}

async function getPlaceById(id: string, db: SupabaseClient): Promise<Place | null> {
  const { data, error } = await db
    .from("places")
    .select(PLACES_SELECT)
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data ? mapPlace(data as unknown as PlaceRow) : null;
}

export async function getPlaceChildren(parentId: string, db: SupabaseClient = supabase): Promise<Place[]> {
  const { data, error } = await db
    .from("places")
    .select(PLACES_SELECT)
    .eq("parent_id", parentId)
    .eq("status", "active")
    .order("sort_order");
  if (error) throw error;
  return ((data ?? []) as unknown as PlaceRow[]).map(mapPlace);
}

const MAX_ANCESTOR_HOPS = 10;

/**
 * Root-first breadcrumb: [state, region, poi]. Capped at 10 hops — a cycle in
 * parent_id (which places_parent_shape should already prevent) would
 * otherwise walk forever and exhaust the heap.
 */
export async function getPlaceAncestors(slug: string, db: SupabaseClient = supabase): Promise<Place[]> {
  const target = await getPlaceBySlug(slug, db);
  if (!target) return [];

  const chain: Place[] = [target];
  let current = target;
  let hops = 0;
  while (current.parentId && hops < MAX_ANCESTOR_HOPS) {
    const parent = await getPlaceById(current.parentId, db);
    if (!parent) break;
    chain.push(parent);
    current = parent;
    hops += 1;
  }
  return chain.reverse();
}

export async function getRegionsWithPois(
  stateSlug: string,
  db: SupabaseClient = supabase,
): Promise<{ region: Place; pois: Place[] }[]> {
  const state = await getPlaceBySlug(stateSlug, db);
  if (!state) return [];

  const regions = await getPlaceChildren(state.id, db);
  if (regions.length === 0) return [];

  const { data, error } = await db
    .from("places")
    .select(PLACES_SELECT)
    .in("parent_id", regions.map((region) => region.id))
    .eq("status", "active")
    .eq("level", "poi")
    .order("sort_order");
  if (error) throw error;

  const pois = ((data ?? []) as unknown as PlaceRow[]).map(mapPlace);
  const poisByRegion = new Map<string, Place[]>();
  for (const poi of pois) {
    if (!poi.parentId) continue;
    const list = poisByRegion.get(poi.parentId) ?? [];
    list.push(poi);
    poisByRegion.set(poi.parentId, list);
  }

  return regions.map((region) => ({ region, pois: poisByRegion.get(region.id) ?? [] }));
}

type ProductPlaceRow = {
  place_id: string;
  product_id: string;
  relation_type: PlaceRelation;
};

/** Load linked products for several places with one relation query and one scoped product read. */
export async function getPlaceProductsForPlaces(
  placeIds: string[],
  db: SupabaseClient = supabase,
): Promise<Map<string, PlaceProduct[]>> {
  const uniquePlaceIds = [...new Set(placeIds.filter(Boolean))];
  const productsByPlace = new Map(uniquePlaceIds.map((placeId) => [placeId, [] as PlaceProduct[]]));
  if (uniquePlaceIds.length === 0) return productsByPlace;

  const { data, error } = await db
    .from("product_places")
    .select("place_id,product_id,relation_type")
    .in("place_id", uniquePlaceIds);
  if (error) throw error;

  const links = (data ?? []) as unknown as ProductPlaceRow[];
  if (links.length === 0) return productsByPlace;

  const relationByPlaceAndProduct = new Map<string, Map<string, PlaceRelation>>();
  for (const link of links) {
    const relationByProduct = relationByPlaceAndProduct.get(link.place_id) ?? new Map<string, PlaceRelation>();
    relationByProduct.set(link.product_id, link.relation_type);
    relationByPlaceAndProduct.set(link.place_id, relationByProduct);
  }

  const productIds = [...new Set(links.map((link) => link.product_id).filter(Boolean))];
  const [activities, vendors] = await Promise.all([
    getActivitiesByIds(productIds, db),
    getVendors(db),
  ]);
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]));

  for (const [placeId, relationByProduct] of relationByPlaceAndProduct) {
    const placeProducts = productsByPlace.get(placeId);
    if (!placeProducts) continue;
    for (const product of activities) {
      const relation = relationByProduct.get(product.id);
      const vendor = product.vendorId ? vendorById.get(product.vendorId) : undefined;
      if (relation && vendor) placeProducts.push({ product, vendor, relation });
    }
  }

  return productsByPlace;
}

/** One-place wrapper used by the detail level of the place page. */
export async function getPlaceProducts(placeId: string, db: SupabaseClient = supabase): Promise<PlaceProduct[]> {
  return (await getPlaceProductsForPlaces([placeId], db)).get(placeId) ?? [];
}

type PlaceAccessRow = {
  id: string;
  place_id: string;
  slug: string;
  title: string;
  description: string;
  access_type: PlaceAccessType;
  source_title: string;
  source_url: string;
  image_source_url: string | null;
  image_path: string | null;
};

/**
 * Source-backed free access belongs to the place, not a vendor catalogue.
 * This deliberately keeps public access outside cart and checkout surfaces.
 */
export async function getPlaceAccesses(placeId: string, db: SupabaseClient = supabase): Promise<PlaceAccess[]> {
  const { data, error } = await db
    .from("place_accesses")
    .select("id,place_id,slug,title,description,access_type,source_title,source_url,image_source_url,image_path")
    .eq("place_id", placeId)
    .eq("status", "active")
    .order("title");
  // The additive table can land after the application during a rolling
  // deployment. Preserve existing place pages until the migration is live;
  // the dedicated remote verifier still fails loudly for that condition.
  if (error?.code === "PGRST205" || error?.code === "42P01") return [];
  // The activity-media migration is additive. During its rolling deployment
  // PostgREST may not know image_path yet; never break the place page while
  // waiting for the schema cache to refresh.
  if (error?.code === "PGRST204" || error?.code === "42703") {
    const legacy = await db
      .from("place_accesses")
      .select("id,place_id,slug,title,description,access_type,source_title,source_url,image_source_url")
      .eq("place_id", placeId)
      .eq("status", "active")
      .order("title");
    if (legacy.error) throw legacy.error;
    return ((legacy.data ?? []) as unknown as Omit<PlaceAccessRow, "image_path">[]).map((row) => ({
      id: row.id,
      placeId: row.place_id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      accessType: row.access_type,
      sourceTitle: row.source_title,
      sourceUrl: row.source_url,
      imageSourceUrl: row.image_source_url,
      imageUrl: null,
    }));
  }
  if (error) throw error;

  return ((data ?? []) as unknown as PlaceAccessRow[]).map((row) => ({
    id: row.id,
    placeId: row.place_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    accessType: row.access_type,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    imageSourceUrl: row.image_source_url,
    imageUrl: placeImageUrl(row.image_path),
  }));
}

type PlaceInformationalActivityRow = {
  id: string;
  place_id: string;
  slug: string;
  title: string;
  description: string;
  activity_type: PlaceInformationalActivityType;
  price_label: string | null;
  source_title: string;
  source_url: string;
  image_source_url: string | null;
  image_path: string | null;
};

/**
 * Official attraction information that is intentionally not made into a
 * fictitious vendor product, cart item, or booking path.
 */
export async function getPlaceInformationalActivities(
  placeId: string,
  db: SupabaseClient = supabase,
): Promise<PlaceInformationalActivity[]> {
  const { data, error } = await db
    .from("place_informational_activities")
    .select("id,place_id,slug,title,description,activity_type,price_label,source_title,source_url,image_source_url,image_path")
    .eq("place_id", placeId)
    .eq("status", "active")
    .order("title");
  if (error?.code === "PGRST205" || error?.code === "42P01") return [];
  if (error?.code === "PGRST204" || error?.code === "42703") {
    const legacy = await db
      .from("place_informational_activities")
      .select("id,place_id,slug,title,description,activity_type,price_label,source_title,source_url,image_source_url")
      .eq("place_id", placeId)
      .eq("status", "active")
      .order("title");
    if (legacy.error) throw legacy.error;
    return ((legacy.data ?? []) as unknown as Omit<PlaceInformationalActivityRow, "image_path">[]).map((row) => ({
      id: row.id,
      placeId: row.place_id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      activityType: row.activity_type,
      priceLabel: row.price_label,
      sourceTitle: row.source_title,
      sourceUrl: row.source_url,
      imageSourceUrl: row.image_source_url,
      imageUrl: null,
    }));
  }
  if (error) throw error;

  return ((data ?? []) as unknown as PlaceInformationalActivityRow[]).map((row) => ({
    id: row.id,
    placeId: row.place_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    activityType: row.activity_type,
    priceLabel: row.price_label,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    imageSourceUrl: row.image_source_url,
    imageUrl: placeImageUrl(row.image_path),
  }));
}

/**
 * Outlets within radiusKm of origin, nearest first. Reuses getOutlets()
 * rather than a dedicated bounding-box query — catalogue.ts's OUTLET_SELECT
 * isn't exported, and duplicating it isn't worth it at this catalogue's
 * scale (tens of outlets, not thousands).
 */
export async function getNearbyOutlets(
  origin: { lat: number; lng: number },
  radiusKm: number,
  db: SupabaseClient = supabase,
): Promise<{ outlet: Outlet; km: number }[]> {
  const outlets = await getOutlets(db);
  const nearby = outlets
    .map((outlet) => ({ outlet, km: haversineKm(origin, { lat: outlet.lat, lng: outlet.lng }) }))
    .filter((entry) => entry.km <= radiusKm)
    .sort((a, b) => a.km - b.km);
  if (nearby.length === 0) return nearby;

  // The place card can reuse the same curated outlet gallery that the outlet
  // page displays when its hero_url is empty. Fetch media only for nearby
  // outlets so unrelated catalogue consumers do not pay for gallery rows.
  const { data: media, error } = await db
    .from("media_assets")
    .select("outlet_id,product_id,url,alt_text,media_type,sort_order")
    .in("outlet_id", nearby.map(({ outlet }) => outlet.id));
  if (error) return nearby;

  const galleryByOutlet = new Map<string, EntityMediaRow[]>();
  for (const row of media ?? []) {
    if (!row.outlet_id || row.product_id !== null) continue;
    const gallery = galleryByOutlet.get(row.outlet_id) ?? [];
    gallery.push({ url: row.url, altText: row.alt_text, mediaType: row.media_type, sortOrder: row.sort_order });
    galleryByOutlet.set(row.outlet_id, gallery);
  }

  return nearby.map((entry) => {
    const coverUrl = entry.outlet.coverUrl ?? selectEntityGallery(galleryByOutlet.get(entry.outlet.id) ?? [], 1)[0]?.url ?? null;
    return { ...entry, outlet: { ...entry.outlet, coverUrl } };
  });
}

/** States that have a places tree — drives the D7 fallback: render the new place-first page only when this includes the state, else fall through to the existing destination page. */
export async function getStatesWithPlaces(db: SupabaseClient = supabase): Promise<string[]> {
  const { data, error } = await db.from("places").select("state").eq("level", "state").eq("status", "active");
  if (error) throw error;
  return [...new Set(((data ?? []) as { state: string }[]).map((row) => row.state))];
}
