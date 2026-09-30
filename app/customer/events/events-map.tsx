"use client";

import { useTranslation } from "react-i18next";
import { MapView, type MapPin } from "@/components/map/map-view";
import { getMalaysiaDateInputValue } from "@/lib/datetime/date-input";
import { DEFAULT_LOCALE, isAppLocale } from "@/lib/i18n/locale";
import { formatEventDateRange } from "@/lib/promotion-campaigns/locations";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

const KUALA_LUMPUR: [number, number] = [3.139, 101.6869];

/** Event locations that have a map pin; the rest are counted below the map. */
export function EventsMap({ campaigns }: { campaigns: PromotionCampaignPublic[] }) {
  const { t, i18n } = useTranslation("customer");
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const today = getMalaysiaDateInputValue();
  const current = campaigns.flatMap((campaign) => campaign.locations
    .filter((location) => location.endsOn >= today)
    .map((location) => ({ campaign, location })));
  const pins: MapPin[] = current
    .filter(({ location }) => location.lat !== null && location.lng !== null)
    .map(({ campaign, location }) => ({
      id: location.id,
      lat: location.lat!,
      lng: location.lng!,
      label: location.name,
      sublabel: `${campaign.title} · ${formatEventDateRange(location.startsOn, location.endsOn, locale)}`,
      href: `/customer/events/${encodeURIComponent(campaign.slug)}`,
    }));
  const unpinned = current.length - pins.length;

  return (
    <div className="space-y-3">
      <div className="h-[min(70svh,560px)] overflow-hidden rounded-2xl border border-border">
        <MapView pins={pins} center={pins[0] ? [pins[0].lat, pins[0].lng] : KUALA_LUMPUR} zoom={pins.length ? 11 : 6} height="100%" markerStyle="pin" />
      </div>
      {unpinned > 0 && <p className="text-sm text-muted-foreground">{t("ui.promotionCampaigns.views.unpinned", { count: unpinned })}</p>}
    </div>
  );
}
