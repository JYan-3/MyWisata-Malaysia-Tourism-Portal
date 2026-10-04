import { describe, expect, it, vi } from "vitest";
import type { EventClickArg } from "@fullcalendar/core";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

const mocks = vi.hoisted(() => ({
  calendarProps: null as unknown,
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@fullcalendar/react", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.calendarProps = props;
    return null;
  },
}));
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/list", () => ({ default: {} }));

import { renderToStaticMarkup } from "react-dom/server";
import { EventsCalendar } from "../events-calendar";

const campaign: PromotionCampaignPublic = {
  id: "campaign-1",
  slug: "heritage-walk",
  title: "Heritage Walk KL",
  summary: "A local event summary.",
  description: "Campaign details.",
  posterUrl: null,
  operatingHours: null,
  startsAt: "2099-01-10T00:00:00.000Z",
  endsAt: "2099-01-12T00:00:00.000Z",
  visibility: "live",
  locations: [{
    id: "location-1",
    name: "Main location",
    address: null,
    lat: null,
    lng: null,
    startsOn: "2099-01-10",
    endsOn: "2099-01-12",
    opensAt: "10:00",
    closesAt: "19:00",
  }],
  vendors: [],
};

type CalendarProps = {
  initialView: string;
  headerToolbar: { left: string; center: string; right: string };
  events: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    classNames: string[];
    extendedProps: { slug: string };
  }>;
  eventClick: (arg: EventClickArg) => void;
};

describe("EventsCalendar", () => {
  it("keeps continuous Malaysia date ranges, status styling, and Month/Agenda navigation", () => {
    renderToStaticMarkup(<EventsCalendar campaigns={[campaign]} />);

    const props = mocks.calendarProps as CalendarProps;
    expect(props.initialView).toBe("dayGridMonth");
    expect(props.headerToolbar).toEqual({
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,listMonth",
    });
    expect(props.events).toEqual([{
      id: "location-1",
      title: "Heritage Walk KL · Main location",
      start: "2099-01-10",
      end: "2099-01-13",
      allDay: true,
      classNames: ["mw-events-calendar__event--live"],
      extendedProps: { slug: "heritage-walk" },
    }]);
  });

  it("opens the campaign detail when a calendar event is clicked", () => {
    renderToStaticMarkup(<EventsCalendar campaigns={[campaign]} />);

    const props = mocks.calendarProps as CalendarProps;
    const preventDefault = vi.fn();
    props.eventClick({
      jsEvent: { preventDefault },
      event: { extendedProps: { slug: "heritage walk" } },
    } as unknown as EventClickArg);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith("/customer/events/heritage%20walk");
  });
});
