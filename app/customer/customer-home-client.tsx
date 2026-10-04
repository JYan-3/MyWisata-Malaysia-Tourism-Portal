"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Compass, MapPin, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { ComputedActivity } from "@/backend/core/types";
import { ActivityCard } from "@/components/customer/activity-card";
import { SaveToggleButton } from "@/components/customer/save-toggle-button";
import { VendorCard, type CustomerVendorCardVendor } from "@/components/customer/vendor-card";
import { destinationHref, MALAYSIA_DESTINATIONS } from "@/lib/customer/malaysia-destinations";
import { useSavedDestinations } from "@/components/providers/saved-destinations";
import dynamic from "next/dynamic";

const DestinationPreviewModal = dynamic(
  () => import("@/components/customer/destination-preview-modal").then((m) => m.DestinationPreviewModal),
  { ssr: false, loading: () => null },
);
const EventCalendarDialog = dynamic(
  () => import("@/components/customer/event-calendar-dialog").then((m) => m.EventCalendarDialog),
  { ssr: false, loading: () => null },
);
import { useEffect, useMemo, useRef, useState } from "react";
import { ATLAS_BRAND_NAME } from "@/lib/i18n/invariant-tokens";
import { useAuth } from "@/components/providers/auth";
import { useCustomerCapabilityGate } from "@/components/customer/use-customer-capability-gate";
import { CUSTOMER_CAPABILITY } from "@/lib/auth/customer-capabilities";
import { PromotionCampaignSpotlight } from "@/components/customer/promotion-campaign-spotlight";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";
import { EventPartnersSection, type EventPartner } from "@/components/customer/event-partners-section";

const PLACEHOLDER_TEXTS = [
  "Where should we wander?",
  "Try 'Penang street food'...",
  "Try 'Mount Kinabalu hike'...",
  "Try 'Langkawi island hopping'...",
  "Try 'Melaka heritage trail'...",
  "Try 'Borneo rainforest'..."
];

function useTypewriterPlaceholder(texts: string[], typingSpeed = 70, deletingSpeed = 40, pauseDelay = 2000) {
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let timeout: NodeJS.Timeout;

    const currentText = texts[index];

    if (isDeleting) {
      if (text.length > 0) {
        timeout = setTimeout(() => setText(currentText.substring(0, text.length - 1)), deletingSpeed);
      } else {
        timeout = setTimeout(() => { setIsDeleting(false); setIndex((i) => (i + 1) % texts.length); }, 0);
      }
    } else {
      if (text.length < currentText.length) {
        timeout = setTimeout(() => setText(currentText.substring(0, text.length + 1)), typingSpeed);
      } else {
        timeout = setTimeout(() => setIsDeleting(true), pauseDelay);
      }
    }

    return () => clearTimeout(timeout);
  }, [text, isDeleting, index, texts, typingSpeed, deletingSpeed, pauseDelay]);

  // Provide a minimum height character (zero-width space or space) to avoid collapse
  return text || " ";
}

export type DemoVendor = CustomerVendorCardVendor & { businessType: string | null };
type NearbyPartner = CustomerVendorCardVendor & { distanceKm: number };
type NearbyLocationSource = "browser" | "city" | "none";

export function CustomerHomeClient({
  recommended,
  popular,
  vendors,
  eventPartners = [],
  campaign,
  campaigns,
  campaignUnavailable = false,
}: {
  recommended: ComputedActivity[];
  popular: ComputedActivity[];
  vendors: DemoVendor[];
  eventPartners?: EventPartner[];
  campaign: PromotionCampaignPublic | null;
  campaigns?: PromotionCampaignPublic[];
  campaignUnavailable?: boolean;
}) {
  const { t } = useTranslation("customer");
  const { currentUser } = useAuth();
  const isGuest = !currentUser;
  const router = useRouter();
  const gate = useCustomerCapabilityGate();
  const [activeState, setActiveState] = useState(() => MALAYSIA_DESTINATIONS[0].state);
  const [query, setQuery] = useState("");
  const { savedStates, toggleSaved } = useSavedDestinations();
  const [previewDestination, setPreviewDestination] = useState<typeof MALAYSIA_DESTINATIONS[number] | null>(null);
  const [eventCalendarOpen, setEventCalendarOpen] = useState(false);
  const [nearbyPartners, setNearbyPartners] = useState<NearbyPartner[] | null>(null);
  const [nearbyLocationSource, setNearbyLocationSource] = useState<NearbyLocationSource | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const destinationRailRef = useRef<HTMLDivElement>(null);
  const placeholderText = useTypewriterPlaceholder(PLACEHOLDER_TEXTS);

  const activeDestination = useMemo(
    () => MALAYSIA_DESTINATIONS.find((destination) => destination.state === activeState) ?? MALAYSIA_DESTINATIONS[0],
    [activeState],
  );
  const activeIndex = MALAYSIA_DESTINATIONS.findIndex((destination) => destination.state === activeDestination.state);
  const nextDestination = MALAYSIA_DESTINATIONS[(activeIndex + 1) % MALAYSIA_DESTINATIONS.length];

  async function loadNearbyPartners(coordinates?: { latitude: number; longitude: number }) {
    setNearbyLoading(true);
    setNearbyError(null);
    try {
      const response = await fetch("/api/customer/nearby-partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(coordinates ?? {}),
      });
      const body = await response.json() as {
        data?: { locationSource: NearbyLocationSource; partners: NearbyPartner[] };
        error?: { message?: string };
      };
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? t("ui.home.nearbyLoadError"));
      }
      setNearbyPartners(body.data.partners.slice(0, 4));
      setNearbyLocationSource(body.data.locationSource);
    } catch (error) {
      setNearbyError(error instanceof Error ? error.message : t("ui.home.nearbyLoadError"));
      setNearbyLocationSource(null);
      setNearbyPartners(null);
    } finally {
      setNearbyLoading(false);
    }
  }

  function useMyLocationForPartners() {
    setNearbyError(null);
    if (!navigator.geolocation) {
      void loadNearbyPartners();
      return;
    }

    setNearbyLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => void loadNearbyPartners({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      () => void loadNearbyPartners(),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    router.push(trimmedQuery ? `/customer/partners?q=${encodeURIComponent(trimmedQuery)}` : "/customer/explore");
  }

  function scrollDestinations(direction: "previous" | "next") {
    const rail = destinationRailRef.current;
    if (!rail) return;
    const distance = Math.max(rail.clientWidth * 0.75, 280);
    rail.scrollBy({ left: direction === "next" ? distance : -distance, behavior: "smooth" });
  }

  const highlightItems = popular.slice(0, 4);
  const highlightIds = new Set(highlightItems.map((activity) => activity.id));
  const forYouItems = recommended.filter((activity) => !highlightIds.has(activity.id)).slice(0, 4);
  const quickSearches = [
    { label: t("ui.home.penangFoodSearch"), query: "Penang" },
    { label: t("ui.home.langkawiIslandSearch"), query: "Langkawi" },
    { label: t("ui.home.melakaHeritageSearch"), query: "Melaka" },
    { label: t("ui.home.sabahNatureSearch"), query: "Sabah" },
  ];

  return (
    <div className="bg-background min-h-screen text-foreground pb-20">
      {/* 1. Hero Section */}
      <section className="atlas-hero-section relative isolate min-h-[calc(100svh-64px)] overflow-hidden bg-primary text-white lg:h-auto lg:min-h-0">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_80%_12%,rgba(255,204,0,0.2),transparent_24%),radial-gradient(circle_at_8%_85%,rgba(84,112,210,0.18),transparent_30%),linear-gradient(125deg,#020044_0%,#05083d_58%,#0a243b_100%)]" />
        <div className="atlas-ambient absolute left-[55%] top-20 -z-10 h-72 w-72 rounded-full border border-white/10 sm:h-96 sm:w-96" />
        <div className="atlas-ambient atlas-ambient-delayed absolute left-[58%] top-32 -z-10 h-56 w-56 rounded-full border border-white/10 sm:h-72 sm:w-72" />

        <div className="mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-10 lg:flex lg:flex-col lg:px-8 lg:pb-6 lg:pt-4">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 lg:mb-2">
            <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-white/60"><Compass size={16} className="text-[#ffcc00]" /> {ATLAS_BRAND_NAME}</div>
            <Link href="/customer/explore" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-bold text-white/80 transition hover:border-[#ffcc00] hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffcc00]/30">{t("ui.home.viewFullMap")} <ArrowRight size={14} /></Link>
          </div>

          <div className="grid items-start gap-8 md:grid-cols-[minmax(0,1fr)_minmax(300px,0.82fr)] md:gap-7 lg:flex-none lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)] lg:gap-10">
            <div className="max-w-2xl">
              <h1 className="atlas-enter atlas-delay-1 max-w-xl font-[family-name:var(--font-display)] text-5xl font-bold leading-[0.96] tracking-[-0.04em] text-[#ffffff] sm:text-7xl lg:text-6xl">{t("ui.home.exploreMalaysia")}</h1>

              <form onSubmit={submitSearch} className="atlas-enter atlas-delay-2 mt-8 flex max-w-xl flex-col gap-2 rounded-[22px] border border-white/15 bg-card p-2 shadow-[0_18px_48px_rgba(0,0,0,0.2)] sm:flex-row sm:items-center lg:mt-5">
                <div className="flex min-w-0 flex-1 items-center gap-3 px-3"><Search size={18} className="shrink-0 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholderText} aria-label={t("ui.home.searchAria")} className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground" /></div>
                <button type="submit" className="atlas-shimmer inline-flex items-center justify-center gap-2 rounded-[16px] bg-[#ffcc00] px-5 py-3 text-sm font-bold text-[#010066] transition hover:bg-[#ffcc00] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffcc00]/40">{t("ui.home.startExploring")} <ArrowRight size={15} /></button>
              </form>

              <div className="atlas-enter atlas-delay-3 mt-8 grid max-w-xl grid-cols-2 gap-4 border-t border-white/15 pt-5 lg:mt-4 lg:pt-3">
                <div><p className="font-mono text-lg font-bold text-[#ffcc00]">{MALAYSIA_DESTINATIONS.length}</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/50">{t("ui.home.destinationCount")}</p></div>
                <div><p className="font-mono text-lg font-bold text-[#ffcc00]">{popular.length}</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/50">{t("ui.home.experienceCount")}</p></div>
              </div>

              <nav aria-label={t("ui.home.quickSearches")} className="atlas-enter atlas-delay-4 mt-5 max-w-xl">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">{t("ui.home.quickSearches")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {quickSearches.map(({ label, query }) => (
                    <Link
                      key={query}
                      href={`/customer/partners?q=${encodeURIComponent(query)}`}
                      className="group flex min-h-11 items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-semibold leading-snug text-white/80 transition hover:border-[#ffcc00]/45 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffcc00]/30"
                    >
                      <span className="min-w-0">{label}</span>
                      <ArrowUpRight size={13} className="shrink-0 text-[#ffcc00]" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </nav>
            </div>

            <div className="atlas-enter atlas-delay-3 relative mx-auto aspect-[0.78] w-full max-w-[460px] md:aspect-auto md:min-h-[500px] md:max-w-[390px] lg:min-h-[500px] lg:max-w-[560px]">
              <div className="atlas-depth-card absolute right-0 top-7 hidden w-[72%] rotate-[5deg] overflow-hidden rounded-[28px] border border-white/20 bg-[#11115f] shadow-2xl lg:block lg:top-8 lg:h-[380px] lg:w-[68%]" aria-hidden="true">
                <div className="relative aspect-[0.72] opacity-80 lg:h-full lg:aspect-auto"><Image src={nextDestination.image} alt="" fill sizes="320px" className="object-cover" /><div className="absolute inset-0 bg-[#010066]/35" /></div>
              </div>
              <div key={activeDestination.state} className="atlas-active-card absolute bottom-0 right-0 z-20 w-full overflow-hidden rounded-[30px] border border-white/20 bg-black/20 shadow-[0_28px_70px_rgba(0,0,0,0.35)] lg:w-[88%]">
                <div className="relative aspect-[0.78] lg:h-[500px] lg:aspect-auto">
                  <Image src={activeDestination.image} alt={`${activeDestination.attraction}, ${activeDestination.state}`} fill sizes="(max-width: 768px) 46vw, 560px" priority className="atlas-active-image object-cover object-top" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                  <div className="absolute inset-x-5 bottom-5 sm:inset-x-7 sm:bottom-7"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffcc00]">{activeDestination.zone}</p><h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold leading-none text-white sm:text-6xl">{activeDestination.state}</h2><p className="mt-3 text-sm font-semibold text-white/85">{activeDestination.attraction}</p><div className="mt-5 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setPreviewDestination(activeDestination)} className="atlas-press inline-flex items-center gap-2 rounded-full bg-[#ffcc00] px-4 py-2.5 text-xs font-bold text-[#010066] transition hover:bg-[#ffcc00] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffcc00]/40">{t("ui.home.viewDestination")} <ArrowUpRight size={14} /></button><SaveToggleButton onClick={() => { if (!gate(CUSTOMER_CAPABILITY.ACCOUNT_MUTATION)) return; void toggleSaved(activeDestination.state); }} appearance="pill" saved={savedStates.has(activeDestination.state)} aria-label={savedStates.has(activeDestination.state) ? t("ui.home.savedDestination") : t("ui.home.saveDestination")} className="atlas-press">{savedStates.has(activeDestination.state) ? t("ui.home.savedDestination") : t("ui.home.saveDestination")}</SaveToggleButton></div></div>
                </div>
              </div>
            </div>
          </div>

          <nav aria-label={t("ui.home.destinationCarousel")} className="mt-12 border-t border-white/15 pt-8 lg:mt-8 lg:pt-6">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffcc00]">{t("ui.home.exploreDestinations")}</p>
                <p className="mt-1 text-xs text-white/55">{t("ui.home.swipeDestinations", { count: MALAYSIA_DESTINATIONS.length })}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="flex items-center gap-1" aria-label={t("ui.home.destinationCarouselControls")}>
                  <button type="button" onClick={() => scrollDestinations("previous")} aria-label={t("ui.map.previous")} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/70 transition hover:border-[#ffcc00] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffcc00]/30">
                    <ChevronLeft size={16} />
                  </button>
                  <button type="button" onClick={() => scrollDestinations("next")} aria-label={t("ui.map.next")} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/70 transition hover:border-[#ffcc00] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffcc00]/30">
                    <ChevronRight size={16} />
                  </button>
                </div>
                <Link href="/customer/explore" className="text-xs font-bold text-[#ffcc00] hover:underline">{t("ui.actions.viewAll")}</Link>
              </div>
            </div>
            <div ref={destinationRailRef} className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar snap-x snap-mandatory scroll-smooth">
              {MALAYSIA_DESTINATIONS.map((dest) => {
                const isSelected = dest.state === activeState;
                return (
                  <button
                    key={dest.state}
                    onClick={() => setActiveState(dest.state)}
                    className={`group relative h-48 w-36 shrink-0 snap-start overflow-hidden rounded-2xl bg-secondary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffcc00]/40 sm:h-56 sm:w-44 lg:h-44 transition border ${isSelected ? "border-[#ffcc00] ring-2 ring-[#ffcc00]/35" : "border-white/15 hover:border-white/40"}`}
                  >
                    <Image src={dest.image} alt={dest.state} fill className="object-cover object-top transition duration-700 group-hover:scale-105" sizes="(min-width: 640px) 176px, 144px" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    <div className="absolute bottom-3 left-3 text-left">
                      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#ffcc00]">{dest.zone}</p>
                      <p className="mt-1 text-sm font-bold text-white">{dest.state}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="mt-8 flex flex-col gap-4 rounded-3xl border border-white/15 bg-white/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 lg:mt-6">
            <h2 className="text-lg font-bold text-white">{t("ui.home.eventCalendar")}</h2>
            <button type="button" onClick={() => setEventCalendarOpen(true)} aria-label={t("ui.home.eventCalendar")} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#ffcc00] px-5 py-3 text-sm font-bold text-[#010066] transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffcc00]/40"><CalendarDays size={17} /> {t("ui.home.viewEventCalendar")} <ArrowRight size={15} /></button>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <PromotionCampaignSpotlight campaign={campaign} campaigns={campaigns} unavailable={campaignUnavailable} />

        {highlightItems.length > 0 && (
          <section aria-labelledby="featured-highlights-heading" className="mt-12">
            <div className="mb-5 flex items-end justify-between gap-4 border-b border-border/70 pb-4">
              <div>
                <h2 id="featured-highlights-heading" className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
                  {t("ui.home.featuredHighlights")}
                </h2>
              </div>
              <Link href="/customer/explore" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-sm font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20">
                {t("ui.actions.viewAll")} <ArrowRight size={14} />
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {highlightItems.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} detailsRevealOnHover detailsRevealStyle="caption" />
              ))}
            </div>
          </section>
        )}

        {!isGuest && forYouItems.length > 0 && (
          <section aria-labelledby="for-you-heading" className="mt-12 rounded-[28px] border border-border/70 bg-secondary/35 p-4 sm:p-6 lg:p-7">
            <div className="mb-5 flex items-end justify-between gap-4">
              <h2 id="for-you-heading" className="flex items-center gap-2 font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
                <Sparkles size={19} className="text-primary" aria-hidden="true" /> {t("ui.home.forYou")}
              </h2>
              <Link href="/customer/for-you" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-sm font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20">
                {t("ui.actions.viewAll")} <ArrowRight size={14} />
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {forYouItems.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} recommendationReason={activity.aiTag ?? undefined} detailsRevealOnHover detailsRevealStyle="caption" />
              ))}
            </div>
          </section>
        )}

        <EventPartnersSection partners={eventPartners.slice(0, 4)} featured />

        <section className="mt-12" aria-labelledby="nearby-partners-heading">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="nearby-partners-heading" className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
                {t("ui.home.nearbyPartners")}
              </h2>
              {nearbyLocationSource === "browser" && <p role="status" className="mt-2 text-sm text-muted-foreground">{t("ui.home.nearbyFromCurrentLocation")}</p>}
              {nearbyLocationSource === "city" && <p role="status" className="mt-2 text-sm text-muted-foreground">{t("ui.home.nearbyFromProfile")}</p>}
              {nearbyPartners === null && <p className="mt-2 text-sm text-muted-foreground">{t("ui.home.nearbyPrompt")}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={useMyLocationForPartners}
                disabled={nearbyLoading}
                aria-busy={nearbyLoading}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-primary transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 disabled:cursor-wait disabled:opacity-60"
              >
                <MapPin size={15} aria-hidden="true" />
                {nearbyLoading ? t("ui.states.loading") : t("ui.map.useCurrentLocation")}
              </button>
              <Link href="/customer/partners" className="inline-flex min-h-10 items-center gap-1 text-sm font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20">
                {t("ui.home.viewPartners")} <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          {nearbyError && <p role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{nearbyError}</p>}
          {nearbyLoading ? (
            <p role="status" aria-live="polite" className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">{t("ui.states.loading")}</p>
          ) : nearbyPartners && nearbyPartners.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {nearbyPartners.slice(0, 4).map((partner, index) => {
                const primaryOutlet = partner.outlets[0];
                const location = [primaryOutlet?.city, primaryOutlet?.state].filter(Boolean).join(", ") || t("ui.labels.malaysia");
                return <VendorCard
                  key={partner.id}
                  vendor={partner}
                  description={partner.description}
                  descriptionFallback={t("ui.home.vendorDescription", { location })}
                  distanceLabel={t("ui.home.distanceAway", { distance: partner.distanceKm.toFixed(1) })}
                  index={index}
                  detailsRevealOnHover
                  detailsRevealStyle="caption"
                />;
              })}
            </div>
          ) : nearbyPartners ? (
            <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              {t(nearbyLocationSource === "none" ? "ui.home.nearbyNoLocation" : "ui.home.noNearbyPartners")} {" "}
              <Link href="/customer/partners" className="font-semibold text-primary underline-offset-4 hover:underline">{t("ui.home.viewPartners")}</Link>
            </p>
          ) : null}
        </section>

        {/* 5. Featured Partners */}
        <section className="mt-12">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-2xl font-bold font-[family-name:var(--font-display)]">{t("ui.home.featuredPartners")}</h2>
            <Link href="/customer/partners" className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20">{t("ui.home.viewPartners")} <ArrowRight size={14} /></Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {vendors.slice(0, 4).map((vendor, index) => {
              const primaryOutlet = vendor.outlets[0];
              const location = [primaryOutlet?.city, primaryOutlet?.state].filter(Boolean).join(", ") || t("ui.labels.malaysia");
              return <VendorCard key={vendor.id} vendor={vendor} description={vendor.description} descriptionFallback={t("ui.home.vendorDescription", { location })} index={index} isFeatured detailsRevealOnHover detailsRevealStyle="caption" />;
            })}
          </div>
        </section>
      </div>

      {previewDestination && (
        <DestinationPreviewModal
          destination={previewDestination}
          onExplore={() => {
            setPreviewDestination(null);
            router.push(destinationHref(previewDestination.state));
          }}
          onClose={() => setPreviewDestination(null)}
        />
      )}
      {eventCalendarOpen && <EventCalendarDialog open onOpenChange={setEventCalendarOpen} />}

      {/* Hero motion. The markup above was copied from the design-demo prototype
          without this block, so every atlas-* class below had no rule and the hero
          sat still. Restored from app/customer/design-demo/design-demo-client.tsx,
          trimmed to the classes this page actually uses. */}
      <style jsx>{`
        :global(:root) {
          --atlas-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
          --atlas-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
        }

        .atlas-enter {
          animation: atlas-enter 900ms var(--atlas-ease-out) both;
        }

        .atlas-delay-1 { animation-delay: 80ms; }
        .atlas-delay-2 { animation-delay: 150ms; }
        .atlas-delay-3 { animation-delay: 230ms; }
        .atlas-delay-4 { animation-delay: 330ms; }
        .atlas-delay-5 { animation-delay: 430ms; }

        .atlas-ambient {
          animation: atlas-orbit 18s var(--atlas-ease-in-out) infinite alternate;
          transform-origin: 50% 50%;
        }

        .atlas-ambient-delayed { animation-delay: -7s; animation-direction: alternate-reverse; }

        .atlas-depth-card { animation: atlas-depth-drift 8s var(--atlas-ease-in-out) infinite alternate; }

          .atlas-active-card { animation: atlas-card-in 720ms var(--atlas-ease-out) both; }

        /* :global because styled-jsx only adds its scoping class to plain DOM
           elements, never to an imported component like next/image — a scoped
           rule here would never match the <Image> and the zoom would not run. */
        :global(.atlas-active-image) { animation: atlas-photo-breathe 16s var(--atlas-ease-in-out) infinite alternate; }

        .atlas-press {
          transition-property: transform, background-color, border-color, color, box-shadow;
          transition-duration: 160ms;
          transition-timing-function: var(--atlas-ease-out);
        }

        .atlas-press:active { transform: scale(0.97); }

        .atlas-shimmer {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          transform: translateZ(0);
        }

        .atlas-shimmer::after {
          position: absolute;
          inset: 0 auto 0 -45%;
          width: 36%;
          content: "";
          background: linear-gradient(105deg, transparent, rgba(255,255,255,0.54), transparent);
          transform: skewX(-18deg);
          animation: atlas-sheen 4.8s var(--atlas-ease-in-out) infinite;
          pointer-events: none;
        }

        .atlas-shimmer > :global(*) { position: relative; z-index: 1; }

        @keyframes atlas-enter {
          from { opacity: 0; transform: translateY(24px); filter: blur(6px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }

        @keyframes atlas-orbit {
          from { transform: rotate(-9deg) scale(0.96); opacity: 0.55; }
          to { transform: rotate(8deg) scale(1.05); opacity: 1; }
        }

        @keyframes atlas-depth-drift {
          from { transform: translate3d(0, 0, 0) rotate(5deg); }
          to { transform: translate3d(-12px, -10px, 0) rotate(8deg); }
        }

        @keyframes atlas-card-in {
          from { opacity: 0; transform: translate3d(0, 26px, 0) scale(0.97); filter: blur(3px); }
          to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0); }
        }

        @keyframes atlas-photo-breathe {
          from { transform: scale(1.02); }
          to { transform: scale(1.09); }
        }

        @keyframes atlas-sheen {
          0%, 35% { transform: translateX(0) skewX(-18deg); opacity: 0; }
          50% { opacity: 1; }
          75%, 100% { transform: translateX(420%) skewX(-18deg); opacity: 0; }
        }

        @media (hover: hover) and (pointer: fine) {
          .atlas-shimmer:hover::after { animation-duration: 1.6s; }
        }

        @media (min-width: 1024px) and (max-height: 850px) {
          .atlas-hero-section {
            height: auto;
            min-height: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .atlas-enter,
          .atlas-ambient,
          .atlas-depth-card,
           .atlas-active-card,
          .atlas-shimmer::after {
            animation: none;
          }

          :global(.atlas-active-image) { animation: none; transform: none; }

          .atlas-press:active { transform: none; }
        }
      `}</style>
    </div>
  );
}
