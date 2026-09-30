import Link from "next/link";
import { CalendarX } from "lucide-react";
import { ReferencePrice } from "@/components/shared/reference-price";
import { EventReserveButton } from "@/components/customer/event-reserve-dialog";
import { getServerTranslation } from "@/lib/i18n/server";
import { formatEventDateRange, formatEventHours } from "@/lib/promotion-campaigns/locations";
import type { VendorEventItem } from "@/lib/promotion-campaigns/vendor-events";

/** A vendor's event items as a table: item, location, date, time, price and reserve. */
export async function EventItemsTable({ items }: { items: VendorEventItem[] }) {
  const { t, locale } = await getServerTranslation("customer");
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card p-10 text-center">
        <CalendarX size={26} className="text-primary" aria-hidden="true" />
        <p className="font-semibold text-foreground">{t("ui.vendor.eventItems.noUpcomingEvent")}</p>
        <p className="text-sm text-muted-foreground">{t("ui.vendor.eventItems.noUpcomingEventHint")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[760px] text-left text-sm">
        <caption className="sr-only">{t("ui.vendor.eventItems.caption")}</caption>
        <thead className="bg-secondary/50 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3">{t("ui.vendor.eventItems.item")}</th>
            <th scope="col" className="px-4 py-3">{t("ui.vendor.eventItems.location")}</th>
            <th scope="col" className="px-4 py-3">{t("ui.vendor.eventItems.date")}</th>
            <th scope="col" className="px-4 py-3">{t("ui.vendor.eventItems.time")}</th>
            <th scope="col" className="px-4 py-3 text-right">{t("ui.vendor.eventItems.price")}</th>
            <th scope="col" className="px-4 py-3"><span className="sr-only">{t("ui.vendor.eventItems.reserve")}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => (
            <tr key={item.key} className="align-top">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {item.product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.product.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="h-11 w-11 shrink-0 rounded-lg bg-secondary" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">{t(`ui.vendor.eventItems.kinds.${item.product.kind}`)}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <p className="font-semibold text-foreground">{item.location.name}</p>
                <Link href={`/customer/events/${encodeURIComponent(item.campaignSlug)}`} className="text-xs font-semibold text-primary hover:underline">
                  {item.campaignTitle}
                </Link>
                {item.stallNumber && <p className="text-xs text-muted-foreground">{t("ui.vendor.eventItems.stall", { stall: item.stallNumber })}</p>}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatEventDateRange(item.location.startsOn, item.location.endsOn, locale)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatEventHours(item.location.opensAt, item.location.closesAt, locale)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-foreground">
                {item.product.price === 0 ? t("ui.vendor.eventItems.free") : <ReferencePrice amountMYR={item.product.price} />}
              </td>
              <td className="px-4 py-3 text-right">
                <EventReserveButton
                  registrationId={item.registrationId}
                  listingId={item.product.id}
                  itemName={item.product.name}
                  price={item.product.price}
                  locationName={item.location.name}
                  startsOn={item.location.startsOn}
                  endsOn={item.location.endsOn}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
