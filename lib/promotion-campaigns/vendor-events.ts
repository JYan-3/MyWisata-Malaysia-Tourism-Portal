import type {
  PromotionCampaignPublic,
  PromotionCampaignPublicLocation,
  PromotionCampaignPublicProduct,
} from "@/lib/promotion-campaigns/types";

/** One item a vendor offers at one event location — a row of the vendor's event table. */
export type VendorEventItem = {
  key: string;
  /** The vendor's registration at this location — reservations and pickup slots belong to it. */
  registrationId: string;
  campaignSlug: string;
  campaignTitle: string;
  location: PromotionCampaignPublicLocation;
  stallNumber: string;
  product: PromotionCampaignPublicProduct;
};

/**
 * Items the vendor offers at event locations that have not ended yet,
 * soonest location first. `today` is the Malaysia calendar date (YYYY-MM-DD).
 */
export function vendorEventItems(campaigns: PromotionCampaignPublic[], vendorId: string, today: string): VendorEventItem[] {
  const rows: VendorEventItem[] = [];
  for (const campaign of campaigns) {
    const vendor = campaign.vendors.find((entry) => entry.vendorId === vendorId);
    if (!vendor) continue;
    for (const stall of vendor.stalls) {
      const location = campaign.locations.find((entry) => entry.id === stall.locationId);
      if (!location || location.endsOn < today) continue;
      for (const product of stall.products) {
        rows.push({
          key: `${stall.registrationId}:${product.id}`,
          registrationId: stall.registrationId,
          campaignSlug: campaign.slug,
          campaignTitle: campaign.title,
          location,
          stallNumber: stall.stallNumber,
          product,
        });
      }
    }
  }
  // Stable sort keeps the vendor's own item order within a location.
  return rows.sort((a, b) => a.location.startsOn.localeCompare(b.location.startsOn) || a.location.name.localeCompare(b.location.name));
}

/** The soonest event location the vendor is taking part in, or null when there is none. */
export function nextVendorEvent(campaigns: PromotionCampaignPublic[], vendorId: string, today: string) {
  let next: { campaignSlug: string; campaignTitle: string; location: PromotionCampaignPublicLocation } | null = null;
  for (const campaign of campaigns) {
    const vendor = campaign.vendors.find((entry) => entry.vendorId === vendorId);
    for (const stall of vendor?.stalls ?? []) {
      const location = campaign.locations.find((entry) => entry.id === stall.locationId);
      if (!location || location.endsOn < today) continue;
      if (!next || location.startsOn < next.location.startsOn) {
        next = { campaignSlug: campaign.slug, campaignTitle: campaign.title, location };
      }
    }
  }
  return next;
}
