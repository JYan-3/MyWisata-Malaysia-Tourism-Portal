"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Building2, Info, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getOptionalDiscoveryCategoryLabelKey } from "@/lib/customer/discovery-categories";
import { getVendorVisual } from "@/lib/customer/vendor-visual";
import { CardMediaHoverCaption } from "@/components/customer/card-media-hover-caption";

export type CustomerVendorCardVendor = {
  id: string;
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  outlets: ReadonlyArray<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
  }>;
};

type VendorCardProps = {
  vendor: CustomerVendorCardVendor;
  categories?: readonly string[];
  description?: string | null;
  descriptionFallback?: string;
  distanceLabel?: string;
  index?: number;
  isFeatured?: boolean;
  showExploreAction?: boolean;
  detailsRevealOnHover?: boolean;
  detailsRevealStyle?: "panel" | "caption";
};

export function VendorCard({
  vendor,
  categories = [],
  description,
  descriptionFallback,
  distanceLabel,
  index = 0,
  isFeatured = false,
  showExploreAction = true,
  detailsRevealOnHover = false,
  detailsRevealStyle = "panel",
}: VendorCardProps) {
  const { t } = useTranslation("customer");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const visual = getVendorVisual(vendor);
  const outlet = vendor.outlets[0];
  const location = [outlet?.city, outlet?.state].filter(Boolean).join(", ") || t("ui.labels.malaysia");
  const cardDescription = description?.trim() || descriptionFallback || t("ui.search.approvedPartnerDescription");
  const categoryLabel = categories.length
    ? categories.map((category) => {
        const key = getOptionalDiscoveryCategoryLabelKey(category);
        return key ? t(key) : category;
      }).join(" · ")
    : t("ui.search.localPartner");
  const badgeLabel = isFeatured ? t("ui.search.featuredPartner") : t("ui.search.verifiedLocalPartner");
  const detailsVisibility = detailsOpen
    ? "flex"
    : detailsRevealStyle === "caption"
      ? "hidden"
      : "hidden group-hover:flex group-focus-within:flex";
  const compactHomeCard = detailsRevealStyle === "caption";
  const detailsId = `vendor-card-details-${vendor.id}`;

  return (
    <article className={`${compactHomeCard ? "mw-card relative" : "relative flex h-full flex-col overflow-hidden rounded-[24px] border border-border bg-card shadow-sm"} group transition duration-300 hover:-translate-y-1 hover:shadow-md`}>
      <div className={compactHomeCard ? "mw-card-media" : "relative aspect-[1.45] overflow-hidden bg-[#eef2ff]"}>
        <Link href={`/customer/vendor/${vendor.id}`} className="absolute inset-0 block focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#010066]/20">
          {visual.coverUrl ? <>
            {/* Vendor-uploaded media is intentionally rendered as a normal img because storage hosts are runtime-configured. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={visual.coverUrl} alt={t("ui.search.businessCover", { vendor: vendor.name })} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </> : <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_25%_20%,rgba(255,204,0,0.28),transparent_28%),linear-gradient(135deg,#010066,#172b72_58%,#2d5273)] text-white">
            <span className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/25 bg-white/10 dark:bg-card/10 text-2xl font-black tracking-tight shadow-xl backdrop-blur-sm">{visual.initials}</span>
            <span className="mt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">{t("ui.search.localPartner")}</span>
          </div>}
          <span className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${isFeatured ? "bg-[#ffcc00] text-[#010066]" : "bg-card/95 text-foreground"}`}>{isFeatured ? <Sparkles size={12} /> : <ShieldCheck size={12} className="text-primary" />} {badgeLabel}</span>
          {detailsRevealStyle !== "caption" && <span className={`absolute bottom-3 left-3 items-center gap-1.5 text-xs font-semibold text-white ${detailsRevealOnHover ? detailsOpen ? "inline-flex" : "hidden group-hover:inline-flex group-focus-within:inline-flex" : "inline-flex"}`}><MapPin size={12} /> {location}</span>}
        </Link>
      {detailsRevealOnHover && (
        <>
          {detailsRevealStyle === "caption" && !detailsOpen && (
            <CardMediaHoverCaption>
              <p className="flex items-start gap-1.5 text-xs font-semibold leading-snug">
                <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{location}{distanceLabel && <> · {distanceLabel}</>}{categories.length > 0 && <> · {categoryLabel}</>}</span>
              </p>
              {showExploreAction && <Link href={`/customer/vendor/${vendor.id}`} className="pointer-events-none inline-flex min-h-7 items-center gap-1 text-xs font-bold text-[#ffcc00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcc00]/60 group-hover:pointer-events-auto group-focus-within:pointer-events-auto">{t("ui.actions.exploreVendor")} <ArrowRight size={13} aria-hidden="true" /></Link>}
            </CardMediaHoverCaption>
          )}
          <button
            type="button"
            aria-label={t("ui.actions.viewDetails")}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((open) => !open)}
            className="absolute right-3 top-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full bg-card/95 text-primary opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <Info size={15} aria-hidden="true" />
          </button>
          <div id={detailsId} className={`absolute left-0 right-0 top-0 z-10 flex ${compactHomeCard ? "aspect-[4/3]" : "aspect-[1.45]"} max-h-full flex-col justify-end gap-2 overflow-y-auto bg-primary/95 px-4 pb-4 pt-12 text-white shadow-inner ${detailsVisibility}`}>
            <span className="inline-flex items-center gap-1.5 break-words text-[11px] font-semibold text-white/85"><MapPin size={13} aria-hidden="true" /> {location}{distanceLabel && <> · {distanceLabel}</>}</span>
            <p className="text-xs leading-5 text-white/90">{cardDescription}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/80">
              <span className="inline-flex items-center gap-1.5"><Building2 size={13} aria-hidden="true" /> {t("ui.search.outletCount", { count: vendor.outlets.length })}</span>
              <span className="min-w-0 break-words text-right">{categoryLabel}</span>
            </div>
            {showExploreAction && <Link href={`/customer/vendor/${vendor.id}`} className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-bold text-[#ffcc00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcc00]/60">{t("ui.actions.exploreVendor")} <ArrowRight size={13} aria-hidden="true" /></Link>}
          </div>
        </>
      )}
      </div>
      <div className={`${compactHomeCard ? "mw-card-body mw-card-body-compact justify-center" : "flex min-h-[220px] flex-1 flex-col"} space-y-3 p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/customer/vendor/${vendor.id}`} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><h2 className="min-h-10 break-words whitespace-normal text-sm font-bold leading-5 text-foreground">{vendor.name}</h2></Link>
            {!detailsRevealOnHover && <p className="mt-1 min-h-10 break-words whitespace-normal text-xs leading-5 text-muted-foreground">{cardDescription}</p>}
          </div>
          {!detailsRevealOnHover && <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#eef2ff] text-xs font-bold text-[#010066]" title={vendor.name}>
            {visual.logoUrl ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={visual.logoUrl} alt={t("ui.vendor.logoAlt", { vendor: vendor.name })} className="h-full w-full object-contain p-1" />
            </> : visual.coverUrl ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={visual.coverUrl} alt="" className="h-full w-full object-cover" />
            </> : visual.initials}
          </span>}
        </div>
        {!detailsRevealOnHover && <div className="flex flex-wrap items-start justify-between gap-2 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Building2 size={13} /> {t("ui.search.outletCount", { count: vendor.outlets.length })}</span><span className="min-w-0 flex-1 break-words whitespace-normal text-right">{categoryLabel}</span></div>}
        {!detailsRevealOnHover && showExploreAction && <Link href={`/customer/vendor/${vendor.id}`} className="mt-auto inline-flex items-center gap-1 text-xs font-bold text-foreground transition hover:text-primary">{t("ui.actions.exploreVendor")} <ArrowRight size={13} /></Link>}
      </div>
      <span className="sr-only">{t("ui.search.vendorCard", { index: index + 1 })}</span>
    </article>
  );
}
