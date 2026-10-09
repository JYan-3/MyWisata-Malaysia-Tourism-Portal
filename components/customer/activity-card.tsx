"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Accessibility, CheckCircle, Clock, Clock3, ImageOff, Info, MapPin, Star, Store } from "lucide-react";
import { useWishlist } from "@/components/providers/wishlist";
import { CategoryIcon } from "@/components/customer/category-icon";
import { SaveToggleButton } from "@/components/customer/save-toggle-button";
import { AiTag } from "./ai-tag";
import { ShareButton } from "@/components/shared/share-button";
import { ReferencePrice } from "@/components/shared/reference-price";
import type { ComputedActivity } from "@/backend/core/types";
import { canonicalCategorySlug, getDiscoveryCategoryLabelKey } from "@/lib/customer/discovery-categories";
import { getOutletShopHref } from "@/lib/customer/shop-navigation";
import { buildActivityPath } from "@/lib/customer/navigation-context";
import { DISTANCE_UNIT_KM, TRENDING_SYMBOL } from "@/lib/i18n/invariant-tokens";
import { useCustomerCapabilityGate } from "@/components/customer/use-customer-capability-gate";
import { CUSTOMER_CAPABILITY } from "@/lib/auth/customer-capabilities";
import { OperatingHoursSummary } from "@/components/customer/operating-hours-summary";
import { CardMediaHoverCaption } from "@/components/customer/card-media-hover-caption";

type ActivityCardItem = ComputedActivity & {
  sponsorship?: { placementId: string; label: "Sponsored" } | null;
};

export function ActivityCard({ activity, recommendationReason, returnTo, outletId, source, onSponsoredClick, detailsRevealOnHover = false, detailsRevealStyle = "panel" }: { activity: ActivityCardItem; recommendationReason?: string; returnTo?: string; outletId?: string; source?: string; onSponsoredClick?: () => void; detailsRevealOnHover?: boolean; detailsRevealStyle?: "panel" | "caption" }) {
  const { t } = useTranslation("customer");
  const [saving, setSaving] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { savedIds, toggleSaved } = useWishlist();
  const gate = useCustomerCapabilityGate();
  const saved = savedIds.has(activity.id);
  const imageSrc = activity.image?.trim();
  const activityHref = buildActivityPath(activity.id, returnTo, outletId, source);
  const categorySlug = canonicalCategorySlug(activity.categorySlug) ?? "activity";
  const categoryLabel = t(getDiscoveryCategoryLabelKey(categorySlug));
  const detailsVisibility = detailsOpen
    ? "flex"
    : detailsRevealStyle === "caption"
      ? "hidden"
      : "hidden group-hover:flex group-focus-within:flex";
  const detailsId = `activity-card-details-${activity.id}`;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImageFailed(false);
  }, [imageSrc]);

  async function handleSave(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (saving) return;
    if (!gate(CUSTOMER_CAPABILITY.ACCOUNT_MUTATION)) return;
    setSaving(true);
    await toggleSaved(activity.id);
    setSaving(false);
  }

  return (
    <article
      className="mw-card group transition-all duration-200 hover:-translate-y-1"
    >
      <div className="mw-card-media">
        <Link href={activityHref} onClick={onSponsoredClick} className="block h-full" aria-label={t("ui.activity.view", { name: activity.name })}>
          {!imageSrc || imageFailed ? (
            <div
              role="img"
              aria-label={t("ui.activity.imageUnavailable", { name: activity.name })}
              className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-indigo-50 dark:from-indigo-500/10 via-slate-50 dark:via-muted to-amber-50 dark:to-amber-500/10 text-primary"
            >
              <ImageOff size={30} strokeWidth={1.5} aria-hidden="true" />
              <span className="mt-2 text-xs font-bold">{activity.category || t("ui.labels.placeBasedExperience")}</span>
              <span className="mt-0.5 text-[10px] text-slate-500 dark:text-muted-foreground">{t("ui.labels.imageUnavailable")}</span>
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={imageSrc}
              alt={activity.name}
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              style={{ backgroundColor: "#EEF2FF" }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
          <div className="absolute left-3 top-3 flex max-w-[calc(100%-5rem)] flex-wrap gap-1.5">
            {!detailsRevealOnHover && <span className="inline-flex items-center gap-1 rounded-full bg-card/95 px-2 py-0.5 text-[10px] font-bold text-primary"><CategoryIcon category={categorySlug} size={11} /> {categoryLabel}</span>}
            {activity.sponsorship && <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:text-amber-200">{t("ui.labels.sponsored")}</span>}
            {!detailsRevealOnHover && activity.isHiddenGem && <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-900 dark:text-violet-200"><CategoryIcon category="hidden_gem" size={11} /> {t("categories.hiddenGem")}</span>}
            {!detailsRevealOnHover && activity.hot && <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">{TRENDING_SYMBOL} {t("ui.labels.trending")}</span>}
          </div>
          {!detailsRevealOnHover && activity.outlet.verified && <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white"><CheckCircle size={9} aria-hidden="true" /> {t("ui.labels.verified")}</div>}
          {!detailsRevealOnHover && activity.outlet.wheelchairAccessible === true && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white" title={t("ui.labels.wheelchairAccessible")}><Accessibility size={9} aria-hidden="true" /> {t("ui.labels.accessible")}</div>}
          {!detailsRevealOnHover && !(activity.outlet.currentlyOpen ?? activity.outlet.open) && <div className="absolute bottom-3 right-3 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: "rgba(36,49,58,0.8)" }}>{t("ui.labels.closed")}</div>}
        </Link>
        {detailsRevealOnHover && (
          <>
            {detailsRevealStyle === "caption" && !detailsOpen && (
              <CardMediaHoverCaption>
                  <p className="flex items-start gap-1.5 text-xs font-semibold leading-snug">
                    <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{activity.outlet.city} · {categoryLabel}</span>
                  </p>
                  {activity.outlet.hours && (
                    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-white/85">
                      <Clock3 size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{activity.outlet.hours}</span>
                    </p>
                  )}
              </CardMediaHoverCaption>
            )}
            <button
              type="button"
              aria-label={t("ui.actions.viewDetails")}
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => setDetailsOpen((open) => !open)}
              className="absolute left-3 top-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full bg-card/95 text-primary opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <Info size={15} aria-hidden="true" />
            </button>
            <div id={detailsId} className={`absolute inset-0 z-10 max-h-full flex-col gap-2 overflow-y-auto bg-primary/95 p-3 pt-12 text-white shadow-inner ${detailsVisibility}`}>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-card/95 px-2 py-0.5 text-[10px] font-bold text-primary"><CategoryIcon category={categorySlug} size={11} /> {categoryLabel}</span>
                {activity.isHiddenGem && <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-900 dark:text-violet-200"><CategoryIcon category="hidden_gem" size={11} /> {t("categories.hiddenGem")}</span>}
                {activity.hot && <span className="inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">{TRENDING_SYMBOL} {t("ui.labels.trending")}</span>}
                {activity.outlet.verified && <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white"><CheckCircle size={9} aria-hidden="true" /> {t("ui.labels.verified")}</span>}
                {activity.outlet.wheelchairAccessible === true && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white"><Accessibility size={9} aria-hidden="true" /> {t("ui.labels.accessible")}</span>}
                {!(activity.outlet.currentlyOpen ?? activity.outlet.open) && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold">{t("ui.labels.closed")}</span>}
              </div>
              <Link href={activityHref} onClick={onSponsoredClick} className="flex items-start gap-1.5 text-xs text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"><MapPin size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> {activity.outlet.city}, {activity.outlet.state}</Link>
              <Link href={getOutletShopHref(activity.outlet.id)} className="flex items-start gap-1.5 text-xs text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"><Store size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> {t("ui.activity.visitShop", { vendor: activity.outlet.vendorName ?? t("ui.labels.localVendor") })}</Link>
              {activity.outlet.operatingHours ? <OperatingHoursSummary hours={activity.outlet.operatingHours} currentlyOpen={activity.outlet.currentlyOpen ?? activity.outlet.open} compact inverse /> : activity.outlet.hours && <p className="text-xs text-white/85"><span className="font-semibold">{t("ui.labels.operatingHours")}</span>{" "}{activity.outlet.hours}</p>}
              <div className="flex min-h-5 items-center gap-3 text-xs text-white/90">
                <div className="flex items-center gap-1"><Star size={11} aria-hidden="true" fill="var(--highlight-yellow)" stroke="none" /><span className="font-semibold">{activity.rating}</span><span>({activity.reviews})</span></div>
                <div className="flex items-center gap-1"><Clock size={10} aria-hidden="true" /> {activity.duration}</div>
                {activity.distanceKm !== undefined && <div>{activity.distanceKm} {DISTANCE_UNIT_KM}</div>}
              </div>
              {(activity.aiTag || recommendationReason) && <AiTag text={recommendationReason ?? activity.aiTag ?? ""} />}
            </div>
          </>
        )}
        <SaveToggleButton
          appearance="icon"
          onClick={handleSave}
          disabled={saving}
          saved={saved}
          aria-label={saved ? t("ui.activity.removeSaved", { name: activity.name }) : t("ui.activity.save", { name: activity.name })}
          title={saved ? t("ui.activity.removeSavedShort") : t("ui.activity.saveShort")}
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center disabled:cursor-wait disabled:opacity-70"
        />
        <div className="absolute right-3 top-12 z-20">
          <ShareButton compact shareType="product" contentId={activity.id} title={activity.name} />
        </div>
      </div>
      <div className={`mw-card-body ${detailsRevealOnHover ? "mw-card-body-compact" : ""} space-y-2 p-4`}>
        <Link href={activityHref} onClick={onSponsoredClick} className="block rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30">
          <h3 className="mw-card-title text-sm font-bold leading-snug text-foreground" title={activity.name}>{activity.name}</h3>
        {!detailsRevealOnHover && <div className="mw-card-meta mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"><MapPin size={11} className="mt-0.5 shrink-0" aria-hidden="true" /> <span className="break-words whitespace-normal">{activity.outlet.city}, {activity.outlet.state}</span></div>}
        </Link>
        {!detailsRevealOnHover && <Link href={getOutletShopHref(activity.outlet.id)} className="mw-card-meta flex items-start gap-1.5 text-xs text-muted-foreground transition hover:text-primary" title={t("ui.activity.visitShop", { vendor: activity.outlet.vendorName ?? t("ui.labels.localVendor") })}>
          <Store size={11} className="mt-0.5 shrink-0" aria-hidden="true" /> <span className="break-words whitespace-normal">{t("ui.activity.visitShop", { vendor: activity.outlet.vendorName ?? t("ui.labels.localVendor") })}</span>
        </Link>}
        {!detailsRevealOnHover && (activity.outlet.operatingHours ? <OperatingHoursSummary hours={activity.outlet.operatingHours} currentlyOpen={activity.outlet.currentlyOpen ?? activity.outlet.open} compact /> : activity.outlet.hours && <div className="mw-card-meta text-xs text-muted-foreground"><span className="font-semibold text-foreground">{t("ui.labels.operatingHours")}:</span> {activity.outlet.hours}</div>)}
        {!detailsRevealOnHover && <div className="flex min-h-5 items-center gap-3">
          <div className="flex items-center gap-1 text-xs"><Star size={11} aria-hidden="true" fill="var(--highlight-yellow)" stroke="none" /><span className="font-semibold text-foreground">{activity.rating}</span><span className="text-muted-foreground">({activity.reviews})</span></div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground"><Clock size={10} aria-hidden="true" /> {activity.duration}</div>
          {activity.distanceKm !== undefined && <div className="text-xs text-muted-foreground">{activity.distanceKm} {DISTANCE_UNIT_KM}</div>}
        </div>}
        {!detailsRevealOnHover && (activity.aiTag || recommendationReason) && <AiTag text={recommendationReason ?? activity.aiTag ?? ""} />}
        <div className="mw-card-footer pt-1">
          <div>
            <ReferencePrice amountMYR={Number(activity.price)} className="font-[family-name:var(--font-mono)] text-lg font-bold text-primary" />
            {(activity.categorySlug === "activity" || activity.requiresBooking) && (
              <span className="ml-1 text-xs text-muted-foreground">/ {t("ui.labels.person")}</span>
            )}
          </div>
          <Link href={activityHref} onClick={onSponsoredClick} className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white">{activity.requiresBooking ? t("ui.actions.bookNow") : t("ui.actions.buyNow")}</Link>
        </div>
      </div>
    </article>
  );
}
