"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { Place } from "@/backend/core/types";
import { formatMYR, formatMYRNumber } from "@/lib/i18n/format";
import { LocalizedContent } from "@/components/customer/localized-content";

export function entryLabel(place: Place, t?: (key: string, options?: Record<string, unknown>) => string): { text: string; tone: string } {
  if (place.entryFee === null) return { text: t?.("ui.place.noGate", { ns: "customer" }) ?? "Public access", tone: "bg-muted text-muted-foreground" };
  if (place.entryFee === 0) return { text: t?.("ui.place.freeEntry", { ns: "customer" }) ?? "Free entry", tone: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" };
  return { text: t?.("ui.place.entryFee", { price: formatMYRNumber(place.entryFee), ns: "customer" }) ?? `${formatMYR(place.entryFee)} entry`, tone: "bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200" };
}

/** A region or POI card in a state/region listing — productCount is precomputed by the page, not fetched here. */
export function PlaceCard({ place, productCount }: { place: Place; productCount: number }) {
  const { t } = useTranslation("customer");
  const entry = entryLabel(place, t);
  const location = [place.district, place.state].filter(Boolean).join(", ");
  return (
    <article className="flex h-full min-h-[390px] flex-col overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
      <Link href={`/customer/place/${place.slug}`} aria-label={t("ui.place.explorePlace", { name: place.name })} className="group/place-media relative block h-48 shrink-0 overflow-hidden bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-52">
        {place.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={place.imageUrl} alt={place.name} className="h-full w-full object-cover transition duration-700 group-hover/place-media:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/15 via-secondary to-primary/5 text-5xl font-black text-primary/30">
            {place.name.charAt(0)}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/55 via-transparent to-slate-950/5" aria-hidden="true" />
        <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-2">
          <span className="rounded-full bg-white/90 dark:bg-card/90 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary backdrop-blur-sm">
            {place.level}
          </span>
          <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${entry.tone}`}>{entry.text}</span>
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="min-h-[3.5rem] break-words whitespace-normal font-[family-name:var(--font-display)] text-2xl font-bold leading-tight tracking-tight text-foreground">
          <LocalizedContent entityType="place" entityId={place.id} field="name" sourceText={place.name}>
            {({ text, control }) => <><Link href={`/customer/place/${place.slug}`} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{text}</Link>{control}</>}
          </LocalizedContent>
        </h3>
        <p className="mt-2 flex items-start gap-1.5 break-words whitespace-normal text-xs font-semibold text-muted-foreground">
          <MapPin size={13} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="break-words whitespace-normal">{location}</span>
        </p>
        <p className="mt-3 min-h-[2.75rem] break-words whitespace-normal text-sm leading-6 text-muted-foreground">
          {place.tagline ? <LocalizedContent entityType="place" entityId={place.id} field="tagline" sourceText={place.tagline} /> : t("ui.place.cardFallback")}
        </p>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-5">
          <span className="text-xs font-bold text-primary">
            {productCount === 0 ? t("ui.labels.freeToExplore") : t("ui.place.vendorOptions", { count: productCount })}
          </span>
          <Link href={`/customer/place/${place.slug}`} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {productCount === 0 ? t("ui.actions.viewDetails") : t("ui.outletMenu.chooseOptions")}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
