"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Info, MapPin, Megaphone, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getVendorVisual } from "@/lib/customer/vendor-visual";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/lib/i18n/locale";
import { formatEventDateRange } from "@/lib/promotion-campaigns/locations";
import { CardMediaHoverCaption } from "@/components/customer/card-media-hover-caption";

export type EventPartner = {
  id: string;
  name: string;
  logoUrl: string | null;
  coverUrl?: string | null;
  description?: string | null;
  /** Soonest event location the partner is at, or null when none is scheduled. */
  next: { campaignTitle: string; locationName: string; startsOn: string; endsOn: string } | null;
};

/** Event vendors, kept apart from the normal partner directory and always labelled "Event partner". */
export function EventPartnersSection({ partners, featured = false }: { partners: EventPartner[]; featured?: boolean }) {
  const { t, i18n } = useTranslation("customer");
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  if (partners.length === 0) return null;
  if (featured) return <FeaturedEventPartnersSection partners={partners.slice(0, 4)} />;

  return (
    <section aria-labelledby="event-partners-heading" className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-primary"><Megaphone size={14} aria-hidden="true" /> {t("ui.eventPartners.eyebrow")}</p>
      <h2 id="event-partners-heading" className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold">{t("ui.eventPartners.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("ui.eventPartners.description")}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {partners.map((partner) => {
          const visual = getVendorVisual({ name: partner.name, logoUrl: partner.logoUrl });
          return (
            <Link
              key={partner.id}
              href={`/customer/vendor/${partner.id}`}
              className="group flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary text-sm font-black text-primary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {visual.logoUrl ? <img src={visual.logoUrl} alt="" className="h-full w-full object-contain p-1" /> : visual.initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-bold text-foreground">{partner.name}</p>
                  <span className="mt-0.5 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">{t("ui.eventPartners.badge")}</span>
                </div>
              </div>
              <p className="mt-4 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                <CalendarDays size={13} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                {partner.next
                  ? t("ui.eventPartners.next", {
                    event: partner.next.campaignTitle,
                    location: partner.next.locationName,
                    dates: formatEventDateRange(partner.next.startsOn, partner.next.endsOn, locale),
                  })
                  : t("ui.eventPartners.noUpcoming")}
              </p>
              <span className="mt-auto pt-4 text-xs font-bold text-primary">
                {t("ui.eventPartners.view")} <ArrowRight size={13} className="inline transition group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function FeaturedEventPartnersSection({ partners }: { partners: EventPartner[] }) {
  const { t, i18n } = useTranslation("customer");
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;

  return (
    <section aria-labelledby="event-featured-partners-heading" className="mt-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 id="event-featured-partners-heading" className="flex items-center gap-2 font-[family-name:var(--font-display)] text-2xl font-bold">
          <Sparkles size={19} className="text-primary" aria-hidden="true" />
          {t("ui.home.eventFeaturedPartners")}
        </h2>
        <Link href="/customer/partners" className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20">
          {t("ui.home.viewPartners")} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {partners.map((partner) => (
          <FeaturedEventPartnerCard key={partner.id} partner={partner} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function FeaturedEventPartnerCard({ partner, locale }: { partner: EventPartner; locale: AppLocale }) {
  const { t } = useTranslation("customer");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const visual = getVendorVisual(partner);
  const detailsVisibility = detailsOpen ? "flex" : "hidden";
  const detailsId = `event-partner-details-${partner.id}`;
  const eventSchedule = partner.next
    ? t("ui.eventPartners.next", {
      event: partner.next.campaignTitle,
      location: partner.next.locationName,
      dates: formatEventDateRange(partner.next.startsOn, partner.next.endsOn, locale),
    })
    : t("ui.eventPartners.noUpcoming");

  return (
    <article className="mw-card group relative min-w-0 transition duration-300 hover:-translate-y-1 hover:shadow-md">
      <div className="mw-card-media">
        {visual.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={visual.coverUrl} alt={t("ui.search.businessCover", { vendor: partner.name })} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_25%_20%,rgba(255,204,0,0.28),transparent_28%),linear-gradient(135deg,#010066,#172b72_58%,#2d5273)]">
            <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-white/25 bg-white/10 text-2xl font-black text-white shadow-xl backdrop-blur-sm">
              {visual.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={visual.logoUrl} alt="" className="h-full w-full object-contain p-2" />
              ) : visual.initials}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        {!detailsOpen && (
          <CardMediaHoverCaption>
            {partner.next && <p className="flex items-start gap-1.5 text-xs font-semibold"><MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{partner.next.locationName}</p>}
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-white/90"><CalendarDays size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{eventSchedule}</p>
          </CardMediaHoverCaption>
        )}
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[#ffcc00] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#010066]">
          <Sparkles size={11} aria-hidden="true" /> {t("ui.home.eventFeaturedPartnerBadge")}
        </span>
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
        <div id={detailsId} className={`absolute inset-0 z-10 max-h-full flex-col gap-2 overflow-y-auto bg-primary/95 px-4 pb-4 pt-12 text-white shadow-inner ${detailsVisibility}`}>
          {partner.next && <p className="flex items-start gap-1.5 text-xs font-semibold"><MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{partner.next.locationName}</p>}
          <p className="flex items-start gap-1.5 text-xs leading-5 text-white/85">
            <CalendarDays size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {eventSchedule}
          </p>
          {partner.description?.trim() && <p className="line-clamp-3 text-xs leading-5 text-white/85">{partner.description}</p>}
          <Link href={`/customer/vendor/${partner.id}`} className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-bold text-[#ffcc00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffcc00]/60">
            {t("ui.eventPartners.view")} <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <div className="mw-card-body mw-card-body-compact items-center p-4">
        <Link href={`/customer/vendor/${partner.id}`} className="min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <h3 className="mw-card-title text-sm font-bold leading-snug text-foreground">{partner.name}</h3>
        </Link>
      </div>
    </article>
  );
}
