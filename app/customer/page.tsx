import { createClient } from "@/lib/supabase/server";
import { getServerTranslation } from "@/lib/i18n/server";
import { getRecommendedFeed } from "@/backend/domains/recommend";
import type { ReasonTag } from "@/backend/domains/recommend-score";
import { rankFeaturedVendors } from "@/backend/domains/vendor-recommend";
import { getCachedComputedActivities } from "@/lib/cache/catalogue-cache";
import { selectEntityLogo, type EntityMediaRow } from "@/lib/customer/entity-media";
import { getVendorVisual } from "@/lib/customer/vendor-visual";
import type { ComputedActivity } from "@/backend/core/types";
import { CustomerHomeClient } from "./customer-home-client";
import { selectFeaturedPublicCampaigns } from "@/lib/customer/promotion-campaigns";
import { resolvePromotionCampaignImages } from "@/lib/promotion-campaigns/images";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

export default async function CustomerHomePage() {
  const db = await createClient();
  const { t } = await getServerTranslation("customer");

  // Localize the dominant recommendation reason for the request's language.
  // Literal `customer:` keys so the i18n extractor attributes them correctly even
  // though this helper is nested inside the component.
  const reasonLabel = (reason: ReasonTag | null): string | undefined => {
    switch (reason) {
      case "near_you": return t("customer:ui.recommendationReasons.near_you");
      case "interests": return t("customer:ui.recommendationReasons.interests");
      case "similar": return t("customer:ui.recommendationReasons.similar");
      case "hidden_gem": return t("customer:ui.recommendationReasons.hidden_gem");
      default: return undefined;
    }
  };
  const [{ data: { user } }, activities, vendorRows, campaignResult] = await Promise.all([
    db.auth.getUser(),
    // Cached for 60 s — same data for all visitors, no user-specific filtering
    getCachedComputedActivities(),
    db
      .from("vendors")
      .select("id,name,description,logo_url,cover_url,business_type,outlets(id,name,city,state,status,review_status)")
      .eq("status", "approved")
      .eq("kind", "shop")
      .order("name")
      .limit(24),
    db.rpc("get_public_promotion_campaigns", { p_slug: null }),
  ]);

  const vendorIds = (vendorRows.data ?? []).map((vendor) => vendor.id);
  const [feed, vendorMediaRows] = await Promise.all([
    getRecommendedFeed(user?.id ?? null, { limit: 8, candidates: activities }, db),
    vendorIds.length
      ? db
        .from("media_assets")
        .select("vendor_id,url,alt_text,media_type,sort_order")
        .in("vendor_id", vendorIds)
        .is("outlet_id", null)
        .is("product_id", null)
        .order("sort_order")
        .then(({ data }) => data ?? [])
      : Promise.resolve([]),
  ]);

  const recommended = feed.map((item) => ({
    ...item.activity,
    aiTag: reasonLabel(item.reason),
  })) as ComputedActivity[];

  const mediaByVendorId = new Map<string, EntityMediaRow[]>();
  for (const row of vendorMediaRows) {
    const rows = mediaByVendorId.get(row.vendor_id) ?? [];
    rows.push({ url: row.url, altText: row.alt_text, mediaType: row.media_type, sortOrder: row.sort_order });
    mediaByVendorId.set(row.vendor_id, rows);
  }

  const vendors = (vendorRows.data ?? [])
    .map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      description: vendor.description,
      logoUrl: getVendorVisual({ name: vendor.name, logoUrl: vendor.logo_url }).logoUrl
        ?? selectEntityLogo(mediaByVendorId.get(vendor.id) ?? []),
      coverUrl: vendor.cover_url,
      businessType: vendor.business_type,
      outlets: (vendor.outlets ?? [])
        .filter((outlet) => outlet.status === "active" && outlet.review_status === "approved")
        .map((outlet) => ({ id: outlet.id, name: outlet.name, city: outlet.city, state: outlet.state })),
    }))
    .filter((vendor) => vendor.outlets.length > 0);

  const featuredVendors = rankFeaturedVendors(vendors, activities, 24);
  const publicCampaigns = resolvePromotionCampaignImages(Array.isArray(campaignResult.data) ? campaignResult.data as unknown as PromotionCampaignPublic[] : []);
  const featuredCampaigns = selectFeaturedPublicCampaigns(publicCampaigns);

  return <CustomerHomeClient popular={activities} recommended={recommended} vendors={featuredVendors} campaign={featuredCampaigns[0] ?? null} campaigns={featuredCampaigns} campaignUnavailable={Boolean(campaignResult.error)} />;
}
