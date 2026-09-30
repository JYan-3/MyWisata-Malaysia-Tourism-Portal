"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVendorVisual } from "@/lib/customer/vendor-visual";
import { DEFAULT_LOCALE, isAppLocale } from "@/lib/i18n/locale";
import { formatEventDateRange } from "@/lib/promotion-campaigns/locations";

export type EventPartner = {
  id: string;
  name: string;
  logoUrl: string | null;
  /** Soonest event location the partner is at, or null when none is scheduled. */
  next: { campaignTitle: string; locationName: string; startsOn: string; endsOn: string } | null;
};

/** Event vendors, kept apart from the normal partner directory and always labelled "Event partner". */
export function EventPartnersSection({ partners }: { partners: EventPartner[] }) {
  const { t, i18n } = useTranslation("customer");
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  if (partners.length === 0) return null;

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
