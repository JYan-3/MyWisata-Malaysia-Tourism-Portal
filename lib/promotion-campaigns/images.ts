import { productImageUrl } from "@/lib/storage/product-image";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

/** Resolves legacy bucket-relative product-cover paths in the public projection through the shared storage URL helper. */
export function resolvePromotionCampaignImages(campaigns: readonly PromotionCampaignPublic[]): PromotionCampaignPublic[] {
  return campaigns.map((campaign) => ({
    ...campaign,
    vendors: campaign.vendors.map((vendor) => ({
      ...vendor,
      products: vendor.products.map((product) => ({ ...product, imageUrl: productImageUrl(product.imageUrl) })),
    })),
  }));
}
