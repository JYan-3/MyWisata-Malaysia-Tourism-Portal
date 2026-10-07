"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PromotionCampaignVendorCard } from "@/components/customer/promotion-campaign-vendor-card";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { isMalaysiaFullDayRange } from "@/lib/datetime/malaysia";
import { getEventOperationalLabelKey } from "@/lib/promotion-campaigns/locations";
import { DEFAULT_LOCALE, isAppLocale } from "@/lib/i18n/locale";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

function CampaignPoster({
  campaign,
  className,
  sizes,
}: {
  campaign: PromotionCampaignPublic;
  className: string;
  sizes: string;
}) {
  return (
    <div data-slot="campaign-poster" className={`relative min-w-0 overflow-hidden bg-secondary ${className}`}>
      {campaign.posterUrl ? (
        <Image
          src={campaign.posterUrl}
          alt=""
          fill
          sizes={sizes}
          unoptimized={campaign.posterUrl.startsWith("http://") || campaign.posterUrl.startsWith("https://")}
          className="object-contain p-2 sm:p-3"
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
          <CalendarDays size={54} strokeWidth={1.25} className="opacity-70" />
        </div>
      )}
    </div>
  );
}

export function PromotionCampaignCard({
  campaign,
  variant = "full",
}: {
  campaign: PromotionCampaignPublic;
  variant?: "full" | "compact";
}) {
  const { t, i18n } = useTranslation("customer");
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const isLive = campaign.visibility === "live";
  const isOperating = campaign.operationalStatus ? campaign.operationalStatus === "operating" : isLive;
  const formatCampaignDate = isMalaysiaFullDayRange(campaign.startsAt, campaign.endsAt) ? formatDate : formatDateTime;
  const previewVendors = campaign.vendors.slice(0, 3);

  if (variant === "compact") {
    return (
      <article aria-labelledby={`campaign-${campaign.id}`} className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm transition-shadow hover:shadow-md">
        <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <CampaignPoster campaign={campaign} className="aspect-[4/3] lg:aspect-auto lg:min-h-72" sizes="(max-width: 1023px) 100vw, (max-width: 1440px) 16vw, 15vw" />
          <div className="flex min-w-0 flex-col p-4 sm:p-5 lg:min-h-72 lg:p-6">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${isOperating ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                {t(getEventOperationalLabelKey(campaign))}
              </span>
              <span className="text-sm text-muted-foreground">
                {t(isLive ? "ui.promotionCampaigns.endsAt" : "ui.promotionCampaigns.startsAt", {
                  date: formatCampaignDate(isLive ? campaign.endsAt : campaign.startsAt, locale, {
                    timeZone: "Asia/Kuala_Lumpur",
                  }),
                })}
              </span>
            </div>
            <span className="mt-3 inline-flex self-start rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
              {t("ui.promotionCampaigns.vendorCount", { count: campaign.vendors.length })}
            </span>
            <h2
              id={`campaign-${campaign.id}`}
              className="mt-3 break-words font-[family-name:var(--font-display)] text-xl font-bold leading-tight text-foreground sm:text-2xl"
            >
              {campaign.title}
            </h2>
            <Button asChild className="mt-5 min-h-11 w-full shrink-0 rounded-full lg:mt-auto">
              <Link href={`/customer/events/${encodeURIComponent(campaign.slug)}`}>
                {t("ui.promotionCampaigns.viewAllVendors", { count: campaign.vendors.length })}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <section aria-labelledby={`campaign-${campaign.id}`} className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <div className="flex min-w-0 flex-col border-b border-border/70 lg:border-b-0 lg:border-r">
          <CampaignPoster campaign={campaign} className="aspect-[16/9] lg:aspect-[4/3]" sizes="(max-width: 1023px) 100vw, 40vw" />
          <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6 lg:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${isOperating ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                {t(getEventOperationalLabelKey(campaign))}
              </span>
              <span className="text-sm text-muted-foreground">
                {t(isLive ? "ui.promotionCampaigns.endsAt" : "ui.promotionCampaigns.startsAt", {
                  date: formatCampaignDate(isLive ? campaign.endsAt : campaign.startsAt, locale, {
                    timeZone: "Asia/Kuala_Lumpur",
                  }),
                })}
              </span>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
                {t("ui.promotionCampaigns.vendorCount", { count: campaign.vendors.length })}
              </span>
            </div>
            <h2
              id={`campaign-${campaign.id}`}
              className="mt-4 break-words font-[family-name:var(--font-display)] text-2xl font-bold leading-tight text-foreground sm:text-3xl"
            >
              {campaign.title}
            </h2>
            <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">
              {campaign.summary}
            </p>
            <Button asChild className="mt-5 min-h-11 w-full shrink-0 rounded-full sm:w-auto lg:mt-auto lg:self-start">
              <Link href={`/customer/events/${encodeURIComponent(campaign.slug)}`}>
                {t("ui.promotionCampaigns.viewAllVendors", { count: campaign.vendors.length })}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
        <div data-slot="campaign-stalls" className="grid min-w-0 content-start grid-cols-1 gap-4 bg-secondary/30 p-5 sm:grid-cols-2 sm:p-6 lg:p-7">
          {previewVendors.map((vendor) => (
            <PromotionCampaignVendorCard
              key={vendor.vendorId}
              vendor={vendor}
              campaignSlug={campaign.slug}
              mode="preview"
            />
          ))}
          {campaign.vendors.length > 3 && (
            <p className="col-span-full text-right text-sm font-medium text-muted-foreground">
              {t("ui.promotionCampaigns.previewVendorCount", {
                shown: previewVendors.length,
                total: campaign.vendors.length,
              })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
