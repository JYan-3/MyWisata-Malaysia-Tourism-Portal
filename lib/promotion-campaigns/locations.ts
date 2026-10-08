import { formatDate } from "@/lib/i18n/format";
import type { AppLocale } from "@/lib/i18n/locale";
import type { PromotionCampaignPublic } from "./types";

export function getEventOperationalLabelKey(campaign: Pick<PromotionCampaignPublic, "visibility" | "operationalStatus">): string {
  if (campaign.operationalStatus === "between_sessions") return "ui.promotionCampaigns.betweenSessions";
  if (campaign.operationalStatus === "operating") return "ui.promotionCampaigns.operating";
  if (campaign.operationalStatus === "upcoming") return "ui.promotionCampaigns.upcoming";
  return campaign.visibility === "live" ? "ui.promotionCampaigns.live" : "ui.promotionCampaigns.upcoming";
}

// Location dates are plain calendar dates (YYYY-MM-DD) and hours are plain
// wall-clock times (HH:MM), both already in Malaysia time. Formatting them in
// UTC stops the browser's own timezone from shifting the day or hour.

export function formatEventDate(isoDate: string, locale: AppLocale): string {
  return formatDate(`${isoDate}T00:00:00Z`, locale, { timeZone: "UTC" });
}

export function formatEventDateRange(startsOn: string, endsOn: string, locale: AppLocale): string {
  return startsOn === endsOn
    ? formatEventDate(startsOn, locale)
    : `${formatEventDate(startsOn, locale)} – ${formatEventDate(endsOn, locale)}`;
}

export function formatEventTime(hhmm: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(`1970-01-01T${hhmm.slice(0, 5)}:00Z`));
}

export function formatEventHours(opensAt: string, closesAt: string, locale: AppLocale): string {
  return `${formatEventTime(opensAt, locale)} – ${formatEventTime(closesAt, locale)}`;
}
