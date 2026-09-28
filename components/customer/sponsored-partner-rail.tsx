"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Building2, Calendar, MapPin } from "lucide-react";
import type { DiscoveryResult } from "@/backend/core/types";
import type { FeaturedEventPromotion } from "@/lib/customer/event-promotions";
import { getOptionalDiscoveryCategoryLabelKey } from "@/lib/customer/discovery-categories";
import { ReferencePrice } from "@/components/shared/reference-price";
import { OperatingHoursSummary } from "@/components/customer/operating-hours-summary";
import { formatDate } from "@/lib/i18n/format";
import { DEFAULT_LOCALE, isAppLocale } from "@/lib/i18n/locale";

function placementIdFor(advertisement: DiscoveryResult): string | null {
  return advertisement.sponsorship?.placementId ?? null;
}

// Vendor-submitted event promotions render as slides in this same carousel
// (not a separate rail) so they share one "Featured recommendations" surface
// with sponsored ads — same card chrome, same autoplay/nav, just a different
// content template per slide kind.
type Slide =
  | { kind: "ad"; id: string; ad: DiscoveryResult }
  | { kind: "event"; id: string; event: FeaturedEventPromotion };

const AUTOPLAY_INTERVAL_MS = 3000;

export function SponsoredPartnerRail({ advertisements, eventPromotions = [] }: { advertisements: DiscoveryResult[]; eventPromotions?: FeaturedEventPromotion[] }) {
  const { t, i18n } = useTranslation("customer");
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const articleRef = useRef<HTMLElement | null>(null);
  const movementDirection = useRef<-1 | 1>(1);
  const impressedPlacementIds = useRef(new Set<string>());

  const eligibleAdvertisements = useMemo(
    () => advertisements.filter((advertisement) => placementIdFor(advertisement) !== null),
    [advertisements],
  );

  const slides = useMemo<Slide[]>(() => [
    ...eventPromotions.map((event): Slide => ({ kind: "event", id: `event-${event.id}`, event })),
    ...eligibleAdvertisements.map((ad): Slide => ({ kind: "ad", id: `ad-${placementIdFor(ad)}`, ad })),
  ], [eventPromotions, eligibleAdvertisements]);

  const slideIds = useMemo(() => slides.map((slide) => slide.id), [slides]);
  const slideSignature = slideIds.join("|");
  const [activeSlideId, setActiveSlideId] = useState<string | null>(() => slideIds[0] ?? null);
  const [previousSlideSignature, setPreviousSlideSignature] = useState(slideSignature);
  const [isPointerPaused, setIsPointerPaused] = useState(false);
  const [isFocusPaused, setIsFocusPaused] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [autoplayEpoch, setAutoplayEpoch] = useState(0);

  if (previousSlideSignature !== slideSignature) {
    setPreviousSlideSignature(slideSignature);
    if (!activeSlideId || !slideIds.includes(activeSlideId)) {
      setActiveSlideId(slideIds[0] ?? null);
    }
  }

  const requestedActiveIndex = slides.findIndex((slide) => slide.id === activeSlideId);
  const normalizedActiveIndex = requestedActiveIndex >= 0 ? requestedActiveIndex : 0;
  const activeSlide = slides[normalizedActiveIndex] ?? null;

  const recordEvent = useCallback((advertisement: DiscoveryResult, eventType: "impression" | "click") => {
    const placementId = placementIdFor(advertisement);
    if (!placementId) return;

    void fetch(`/api/sponsored-placements/${placementId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, productId: advertisement.id }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setIsDocumentVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = (event: MediaQueryListEvent | MediaQueryList) => {
      setPrefersReducedMotion(event.matches);
    };
    updatePreference(mediaQuery);
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  const moveBy = useCallback((direction: -1 | 1, manual = false) => {
    movementDirection.current = direction;
    setActiveSlideId((currentSlideId) => {
      const count = slides.length;
      if (count === 0) return null;
      const currentIndex = slides.findIndex((slide) => slide.id === currentSlideId);
      const normalizedCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (normalizedCurrentIndex + direction + count) % count;
      return slides[nextIndex].id;
    });
    if (manual) setAutoplayEpoch((current) => current + 1);
  }, [slides]);

  useEffect(() => {
    if (
      slides.length < 2
      || isPointerPaused
      || isFocusPaused
      || !isDocumentVisible
      || prefersReducedMotion
    ) return;

    const intervalId = setInterval(() => moveBy(1), AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [
    autoplayEpoch,
    slides.length,
    isDocumentVisible,
    isFocusPaused,
    isPointerPaused,
    moveBy,
    prefersReducedMotion,
  ]);

  useEffect(() => {
    if (!activeSlide || activeSlide.kind !== "ad" || typeof IntersectionObserver === "undefined") return;
    const article = articleRef.current;
    const placementId = placementIdFor(activeSlide.ad);
    if (!article || !placementId) return;

    const observer = new IntersectionObserver((entries) => {
      if (
        entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)
        && !impressedPlacementIds.current.has(placementId)
      ) {
        impressedPlacementIds.current.add(placementId);
        recordEvent(activeSlide.ad, "impression");
      }
    }, { threshold: 0.5 });

    observer.observe(article);
    return () => observer.disconnect();
  }, [activeSlide, recordEvent]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || prefersReducedMotion || typeof article.animate !== "function") return;
    const animation = article.animate([
      { opacity: 0, transform: `translateX(${movementDirection.current * 20}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ], { duration: 360, easing: "ease-out" });
    return () => animation.cancel();
  }, [activeSlide, prefersReducedMotion]);

  if (!activeSlide) return null;

  const hasMultipleSlides = slides.length > 1;

  return (
    <section
      className="border-b border-border bg-secondary/25"
      aria-labelledby="featured-partner-heading"
      onMouseEnter={() => setIsPointerPaused(true)}
      onMouseLeave={() => setIsPointerPaused(false)}
      onFocusCapture={() => setIsFocusPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFocusPaused(false);
      }}
    >
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">{t("ui.labels.featured")}</p>
            <h2 id="featured-partner-heading" className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
              {t("ui.search.featuredRecommendations")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("ui.search.featuredDescription")}</p>
          </div>
        </div>

        <div
          data-testid="sponsored-partner-rail"
          className="group/carousel relative w-full overflow-hidden rounded-[28px] border border-border bg-card shadow-sm"
          aria-roledescription={t("ui.search.featuredCarousel")}
        >
          {activeSlide.kind === "event" ? (
            <article key={activeSlide.id} ref={articleRef} className="group w-full overflow-hidden bg-card">
              <Link
                href={`/customer/event-promotions/${activeSlide.event.id}`}
                className="grid min-h-[320px] w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-primary/20 md:grid-cols-[52%_48%]"
              >
                <div className="relative min-h-60 overflow-hidden bg-secondary md:min-h-[340px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={activeSlide.event.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <span className="absolute left-5 top-5 rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-slate-950 shadow-sm">
                    {t("ui.labels.featured")}
                  </span>
                </div>
                <div className="flex min-h-[300px] flex-col px-8 py-9 md:min-h-[340px] md:px-12 md:py-11">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">{t("ui.eventPromotions.rail.eyebrow")}</p>
                  <h3 className="mt-3 break-words whitespace-normal font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-foreground lg:text-4xl">
                    {activeSlide.event.title}
                  </h3>
                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                    <span className="inline-flex min-w-0 items-start gap-2 break-words whitespace-normal">
                      <Building2 size={16} className="shrink-0" aria-hidden="true" />
                      {t("ui.search.providedBy", { vendor: activeSlide.event.vendorName })}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar size={15} aria-hidden="true" />
                      {activeSlide.event.startDate === activeSlide.event.endDate
                        ? formatDate(activeSlide.event.startDate, locale)
                        : `${formatDate(activeSlide.event.startDate, locale)} – ${formatDate(activeSlide.event.endDate, locale)}`}
                    </span>
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-8 text-sm font-bold text-primary">
                    {t("ui.actions.viewDetails")} <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </div>
              </Link>
            </article>
          ) : (() => {
            const ad = activeSlide.ad;
            const placementId = placementIdFor(ad);
            if (!placementId) return null;
            const image = ad.outlet.coverUrl?.trim() || null;
            const location = [ad.outlet.city, ad.outlet.state].filter(Boolean).join(", ");
            const categoryKey = getOptionalDiscoveryCategoryLabelKey(ad.categorySlug);
            return (
              <article key={activeSlide.id} ref={articleRef} data-placement-id={placementId} className="group w-full overflow-hidden bg-card">
                <Link
                  href={`/customer/activity/${ad.id}`}
                  onClick={() => recordEvent(ad, "click")}
                  className="grid min-h-[320px] w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-primary/20 md:grid-cols-[52%_48%]"
                >
                  <div className="relative min-h-60 overflow-hidden bg-secondary md:min-h-[340px]">
                    {image && <>
                      {/* Outlet photos come from its published Hero or curated outlet gallery. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image} alt={ad.outlet.name} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    </>}
                    <span className="absolute left-5 top-5 rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-slate-950 shadow-sm">
                      {t("ui.labels.featured")}
                    </span>
                    <span className={`absolute bottom-5 left-5 inline-flex max-w-[calc(100%-2.5rem)] items-start gap-1.5 break-words whitespace-normal text-sm font-semibold ${image ? "text-white" : "text-muted-foreground"}`}>
                      <MapPin size={15} aria-hidden="true" /> {location}
                    </span>
                  </div>
                  <div className="flex min-h-[300px] flex-col px-8 py-9 md:min-h-[340px] md:px-12 md:py-11">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                      {categoryKey ? t(categoryKey) : ad.category}
                    </p>
                    <h3 className="mt-3 break-words whitespace-normal font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-foreground lg:text-4xl">
                      {ad.name}
                    </h3>
                    <p className="mt-4 max-w-xl break-words whitespace-normal text-base leading-7 text-muted-foreground">{ad.description}</p>
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
                      <span className="inline-flex min-w-0 items-start gap-2 break-words whitespace-normal">
                        <Building2 size={16} className="shrink-0" aria-hidden="true" />
                        {t("ui.search.providedBy", { vendor: ad.outlet.vendorName })}
                      </span>
                      <ReferencePrice amountMYR={Number(ad.price)} className="shrink-0 text-base font-bold text-foreground" />
                    </div>
                    {ad.outlet.operatingHours ? <div className="mt-3"><OperatingHoursSummary hours={ad.outlet.operatingHours} currentlyOpen={ad.outlet.currentlyOpen ?? ad.outlet.open} /></div> : ad.outlet.hours && <p className="mt-3 text-sm text-muted-foreground"><span className="font-semibold text-foreground">{t("ui.labels.operatingHours")}:</span> {ad.outlet.hours}</p>}
                    <span className="mt-auto inline-flex items-center gap-1.5 pt-8 text-sm font-bold text-primary">
                      {t("ui.actions.viewDetails")} <ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              </article>
            );
          })()}

          {hasMultipleSlides ? (
            <>
            <button
              type="button"
              aria-label={t("ui.search.previousAdvertisement")}
              onClick={() => moveBy(-1, true)}
              className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/60 bg-background/90 text-primary opacity-100 shadow-lg backdrop-blur transition-[opacity,transform,border-color] hover:scale-105 hover:border-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 sm:left-5 md:opacity-0 md:group-hover/carousel:opacity-100 md:group-focus-within/carousel:opacity-100"
            >
              <ArrowLeft size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={t("ui.search.nextAdvertisement")}
              onClick={() => moveBy(1, true)}
              className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/60 bg-background/90 text-primary opacity-100 shadow-lg backdrop-blur transition-[opacity,transform,border-color] hover:scale-105 hover:border-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 sm:right-5 md:opacity-0 md:group-hover/carousel:opacity-100 md:group-focus-within/carousel:opacity-100"
            >
              <ArrowRight size={17} aria-hidden="true" />
            </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
