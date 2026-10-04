"use client";

import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import type { EventClickArg } from "@fullcalendar/core";
import { useTranslation } from "react-i18next";
import { addMalaysiaCalendarDays, getMalaysiaDateInputValue } from "@/lib/datetime/date-input";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

/** One all-day entry per event location, spanning its own dates. Loaded only when the Calendar view opens. */
export function EventsCalendar({ campaigns }: { campaigns: PromotionCampaignPublic[] }) {
  const { t } = useTranslation("customer");
  const router = useRouter();
  const today = getMalaysiaDateInputValue();
  const entries = campaigns.flatMap((campaign) => campaign.locations
    .filter((location) => location.endsOn >= today)
    .map((location) => ({
      id: location.id,
      title: `${campaign.title} · ${location.name}`,
      start: location.startsOn,
      // FullCalendar's all-day end is exclusive.
      end: addMalaysiaCalendarDays(location.endsOn, 1),
      allDay: true,
      classNames: [`mw-events-calendar__event--${campaign.visibility}`],
      extendedProps: { slug: campaign.slug },
    })));
  const firstStart = entries.map((entry) => entry.start).sort()[0];

  function openEvent(arg: EventClickArg) {
    arg.jsEvent.preventDefault();
    router.push(`/customer/events/${encodeURIComponent(arg.event.extendedProps.slug as string)}`);
  }

  return (
    <div className="mw-customer-calendar mw-events-calendar min-w-0 rounded-2xl border border-border bg-card p-2 shadow-sm sm:p-4">
      <FullCalendar
        plugins={[dayGridPlugin, listPlugin]}
        initialView="dayGridMonth"
        initialDate={firstStart && firstStart > today ? firstStart : today}
        events={entries}
        eventClick={openEvent}
        height="auto"
        dayMaxEvents={3}
        eventDisplay="block"
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,listMonth" }}
        buttonText={{ today: t("ui.home.today"), month: t("ui.home.month"), listMonth: t("ui.home.agenda") }}
        noEventsText={t("ui.promotionCampaigns.views.calendarEmpty")}
      />
    </div>
  );
}
