import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

/**
 * Selects from the database's already-eligible public projection without
 * trusting a stale visibility label. Live campaigns (soonest-ending first)
 * come before upcoming ones (soonest-starting first) — same ordering the
 * single-campaign selector below has always used, just not truncated to one.
 */
export function selectFeaturedPublicCampaigns(
  campaigns: readonly PromotionCampaignPublic[],
  now: Date = new Date(),
): PromotionCampaignPublic[] {
  const visible = campaigns.filter((campaign) => {
    const startsAt = Date.parse(campaign.startsAt);
    const endsAt = Date.parse(campaign.endsAt);
    return Number.isFinite(startsAt)
      && Number.isFinite(endsAt)
      && startsAt < endsAt
      && endsAt > now.getTime()
      && campaign.vendors.length > 0;
  });
  const live = visible
    .filter((campaign) => Date.parse(campaign.startsAt) <= now.getTime())
    .sort((left, right) => Date.parse(left.endsAt) - Date.parse(right.endsAt));
  const upcoming = visible
    .filter((campaign) => Date.parse(campaign.startsAt) > now.getTime())
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  return [...live, ...upcoming];
}

/** Single-campaign convenience wrapper — same ordering, just the first result. */
export function selectFeaturedPublicCampaign(
  campaigns: readonly PromotionCampaignPublic[],
  now: Date = new Date(),
): PromotionCampaignPublic | null {
  return selectFeaturedPublicCampaigns(campaigns, now)[0] ?? null;
}
