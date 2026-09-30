export const PROMOTION_CAMPAIGN_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "paused",
  "archived",
] as const;

export type PromotionCampaignStatus = (typeof PROMOTION_CAMPAIGN_STATUSES)[number];
export type PromotionCampaignVisibility = "upcoming" | "live";
export type PromotionCampaignAction = "submit" | "approve" | "reject" | "pause" | "resume" | "archive";

export type PromotionCampaignVendorRegistrationStatus = "pending" | "approved" | "rejected" | "changes_requested";

export type PromotionCampaignPublicProduct = {
  id: string;
  name: string;
  /** "service" = an experience or service with no physical item; price 0 = free reservation. */
  kind: "product" | "service";
  price: number;
  imageUrl: string | null;
};

export type PromotionCampaignPublicLocation = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** YYYY-MM-DD, Malaysia calendar date. */
  startsOn: string;
  endsOn: string;
  /** HH:MM, Malaysia local time. */
  opensAt: string;
  closesAt: string;
};

/** One approved registration of a vendor at one event location. */
export type PromotionCampaignPublicStall = {
  registrationId: string;
  locationId: string;
  stallNumber: string;
  stallDescription: string;
  stallPosterUrl: string;
  products: PromotionCampaignPublicProduct[];
};

/** A participating vendor, listed once, with one stall per location they joined. */
export type PromotionCampaignPublicVendor = {
  vendorId: string;
  vendorName: string;
  vendorLogoUrl: string | null;
  /** "event" vendors sell only at events and are always labelled "Event partner". */
  vendorKind: "shop" | "event";
  stalls: PromotionCampaignPublicStall[];
};

export type PromotionCampaignPublic = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  posterUrl: string | null;
  operatingHours: string | null;
  startsAt: string;
  endsAt: string;
  visibility: PromotionCampaignVisibility;
  locations: PromotionCampaignPublicLocation[];
  vendors: PromotionCampaignPublicVendor[];
};
