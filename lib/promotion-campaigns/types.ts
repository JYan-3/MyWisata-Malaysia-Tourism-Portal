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
  price: number;
  imageUrl: string | null;
};

export type PromotionCampaignPublicVendor = {
  registrationId: string;
  vendorId: string;
  vendorName: string;
  vendorLogoUrl: string | null;
  stallNumber: string;
  stallDescription: string;
  stallPosterUrl: string;
  products: PromotionCampaignPublicProduct[];
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
  vendors: PromotionCampaignPublicVendor[];
};
