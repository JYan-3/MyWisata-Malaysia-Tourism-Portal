"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Sparkles, Store } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { PromotionCampaignPublicVendor } from "@/lib/promotion-campaigns/types";

type Props = {
  vendor: PromotionCampaignPublicVendor;
  campaignSlug: string;
  mode: "preview" | "detail";
};

/** A participating vendor's stall within an event — replaces the retired offer-card (see 20260928180000). */
export function PromotionCampaignVendorCard({ vendor, campaignSlug, mode }: Props) {
  const { t } = useTranslation("customer");
  const image = vendor.stallPosterUrl || vendor.vendorLogoUrl;

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="relative aspect-[16/8] overflow-hidden bg-gradient-to-br from-primary/10 via-secondary to-highlight-yellow/20">
        {image ? (
          <Image src={image} alt={vendor.vendorName} fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized={image.startsWith("http://") || image.startsWith("https://")} className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-primary"><Sparkles size={28} aria-hidden="true" /></div>
        )}
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-xs font-bold text-primary shadow-sm">
          <Store size={13} aria-hidden="true" /> {t("ui.promotionCampaigns.stallNumber", { number: vendor.stallNumber })}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h3 className="break-words font-bold text-foreground">{vendor.vendorName}</h3>
        {mode === "detail" && <p className="mt-2 line-clamp-3 break-words text-sm leading-6 text-muted-foreground">{vendor.stallDescription}</p>}
        {vendor.products.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">{t("ui.promotionCampaigns.productCount", { count: vendor.products.length })}</p>
        )}
        <div className="mt-auto pt-4">
          <Button asChild className="w-full rounded-full">
            <Link href={`/customer/events/${encodeURIComponent(campaignSlug)}/${encodeURIComponent(vendor.vendorId)}`}>
              {t("ui.promotionCampaigns.viewStall")} <ArrowUpRight size={15} />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
