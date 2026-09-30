"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Clock, MapPin, Megaphone, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CustomerPageHeader, CustomerPageShell } from "@/components/customer/customer-page-shell";
import { PromotionCampaignVendorCard } from "@/components/customer/promotion-campaign-vendor-card";
import { formatDateTime } from "@/lib/i18n/format";
import { DEFAULT_LOCALE, isAppLocale } from "@/lib/i18n/locale";
import { formatEventDateRange, formatEventHours } from "@/lib/promotion-campaigns/locations";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

type Props = {
  slug: string;
  initialCampaign: PromotionCampaignPublic | null;
  initialError: "load" | "missing" | null;
};

export function PromotionCampaignDetailClient({ slug, initialCampaign, initialError }: Props) {
  const { t, i18n } = useTranslation("customer");
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const [campaign, setCampaign] = useState(initialCampaign);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<"load" | "missing" | null>(initialError);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/customer/promotion-campaigns?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 404) { setCampaign(null); setError("missing"); return; }
      if (!response.ok || !payload.data?.campaign) throw new Error("campaign_unavailable");
      setCampaign(payload.data.campaign as PromotionCampaignPublic);
      setError(null);
    } catch {
      setCampaign(null);
      setError("load");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await load();
  }, [load]);

  return (
    <CustomerPageShell wide>
      <CustomerPageHeader
        eyebrow={t("ui.promotionCampaigns.eyebrow")}
        title={campaign?.title ?? t("ui.promotionCampaigns.detailTitle")}
        description={campaign ? undefined : t("ui.promotionCampaigns.detailDescription")}
        icon={<Megaphone size={15} />}
        actions={<Button asChild variant="outline" className="rounded-full"><Link href="/customer/events"><ArrowLeft size={15} /> {t("ui.promotionCampaigns.backToEvents")}</Link></Button>}
      />
      {loading ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">{t("ui.promotionCampaigns.loading")}</p> : error ? (
        <div role="alert" className="rounded-3xl border border-border bg-card p-8 text-center"><CalendarDays size={28} className="mx-auto text-primary" /><h2 className="mt-3 font-bold text-foreground">{t(error === "missing" ? "ui.promotionCampaigns.notFound" : "ui.promotionCampaigns.loadError")}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{t(error === "missing" ? "ui.promotionCampaigns.notFoundDescription" : "ui.promotionCampaigns.tryAgainDescription")}</p><div className="mt-5 flex justify-center gap-2">{error === "load" && <Button variant="outline" className="rounded-full" onClick={() => void refresh()}><RefreshCw size={14} /> {t("ui.actions.retry")}</Button>}<Button asChild className="rounded-full"><Link href="/customer/events">{t("ui.promotionCampaigns.backToEvents")}</Link></Button></div></div>
      ) : campaign && <>
        <section className="mb-7 overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-r from-primary/[0.07] via-card to-highlight-yellow/10">
          {campaign.posterUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={campaign.posterUrl} alt="" className="h-48 w-full object-cover sm:h-64" />
          )}
          <div className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${campaign.visibility === "live" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                {t(campaign.visibility === "live" ? "ui.promotionCampaigns.live" : "ui.promotionCampaigns.upcoming")}
              </span>
              <CalendarDays size={14} className="ml-1 text-primary" />
              <span className="text-sm text-muted-foreground">
                {formatDateTime(campaign.startsAt, locale, { timeZone: "Asia/Kuala_Lumpur" })} – {formatDateTime(campaign.endsAt, locale, { timeZone: "Asia/Kuala_Lumpur" })}
              </span>
            </div>
            {campaign.locations.length > 0 && (
              <section aria-labelledby="event-locations-heading" className="mt-5">
                <h2 id="event-locations-heading" className="text-sm font-bold uppercase tracking-[0.14em] text-primary">
                  {t("ui.promotionCampaigns.locationsSection", { count: campaign.locations.length })}
                </h2>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {campaign.locations.map((location) => (
                    <li key={location.id} className="rounded-2xl border border-border bg-card/80 p-4">
                      <p className="flex items-start gap-2 font-semibold text-foreground"><MapPin size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />{location.name}</p>
                      <p className="mt-1 break-words pl-6 text-xs text-muted-foreground">{location.address ?? t("ui.promotionCampaigns.addressTba")}</p>
                      <p className="mt-2 flex items-center gap-2 pl-6 text-xs text-muted-foreground"><CalendarDays size={13} aria-hidden="true" />{formatEventDateRange(location.startsOn, location.endsOn, locale)}</p>
                      <p className="mt-1 flex items-center gap-2 pl-6 text-xs text-muted-foreground"><Clock size={13} aria-hidden="true" />{formatEventHours(location.opensAt, location.closesAt, locale)}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <h2 className="mt-4 font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
              {t("ui.promotionCampaigns.vendorsSection")}
            </h2>
            <details className="mt-3 rounded-2xl border border-primary/10 bg-card/70 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-primary underline-offset-4 hover:underline">
                {t("ui.promotionCampaigns.campaignDetails")}
              </summary>
              <p className="mt-3 max-w-3xl whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">
                {campaign.description}
              </p>
            </details>
            {campaign.visibility === "upcoming" && (
              <p className="mt-4 rounded-xl bg-amber-100/70 px-4 py-3 text-sm font-medium text-amber-950">
                {t("ui.promotionCampaigns.upcomingNotice")}
              </p>
            )}
          </div>
        </section>
        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">{campaign.vendors.map((vendor) => <PromotionCampaignVendorCard key={vendor.vendorId} vendor={vendor} campaignSlug={campaign.slug} mode="detail" />)}</div>
        {campaign.vendors.length === 0 && <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">{t("ui.promotionCampaigns.noVendors")}</p>}
      </>}
    </CustomerPageShell>
  );
}
