"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, BedDouble, Check, MapPin, Maximize2, Navigation, Star, Users } from "lucide-react";
import type { GalleryItem, OutletRendererOutlet, OutletRendererProduct } from "@/components/outlet/outlet-block-types";
import { RoomDetailsDialog } from "@/components/outlet/room-details-dialog";
import { MediaGallery } from "@/components/customer/media-gallery";
import { ReferencePrice } from "@/components/shared/reference-price";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCart } from "@/components/providers/cart";
import { useWishlist } from "@/components/providers/wishlist";
import { SaveToggleButton } from "@/components/customer/save-toggle-button";
import { cartItemKey } from "@/backend/core/helpers";
import { useCustomerCapabilityGate } from "@/components/customer/use-customer-capability-gate";
import { CUSTOMER_CAPABILITY } from "@/lib/auth/customer-capabilities";

function RoomCard({ outlet, room }: { outlet: OutletRendererOutlet; room: OutletRendererProduct }) {
  const { t } = useTranslation("customer");
  const router = useRouter();
  const gate = useCustomerCapabilityGate();
  const { addItem, setSelectedKeys } = useCart();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stay = outlet.stay!;
  const offer = room.stay!;
  const soldOut = offer.left < stay.rooms || !offer.checkInSlotId;
  const photo = offer.photos[0];

  async function book() {
    if (soldOut || !gate(CUSTOMER_CAPABILITY.CART_MUTATION)) return;
    setWorking(true);
    setError(null);
    try {
      const line = { activityId: room.id, variantId: room.variant_id ?? "", slotId: offer.checkInSlotId!, outletId: outlet.id, nights: stay.nights };
      await addItem({ ...line, qty: stay.rooms, priceOverride: offer.total });
      setSelectedKeys([cartItemKey(line)]);
      router.push("/customer/checkout");
    } catch {
      setError(t("ui.property.bookError"));
      setWorking(false);
    }
  }

  return (
    <article className="grid gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:grid-cols-[12rem_1fr_auto] sm:p-5">
      <div className="aspect-[4/3] overflow-hidden rounded-xl bg-secondary">
        {photo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={photo} alt={room.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-primary"><BedDouble size={28} aria-hidden="true" /></div>
        )}
      </div>
      <div className="min-w-0">
        <h3 className="break-words text-lg font-bold text-foreground">{room.name}</h3>
        {(offer.details.maxGuests || offer.details.sizeSqm || offer.details.bedType) && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {offer.details.bedType && <span className="inline-flex items-center gap-1"><BedDouble size={13} aria-hidden="true" />{offer.details.bedType}</span>}
            {offer.details.maxGuests && <span className="inline-flex items-center gap-1"><Users size={13} aria-hidden="true" />{t("ui.hotel.sleepsCount", { count: offer.details.maxGuests })}</span>}
            {offer.details.sizeSqm && <span className="inline-flex items-center gap-1"><Maximize2 size={13} aria-hidden="true" />{offer.details.sizeSqm} m²</span>}
          </p>
        )}
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{room.description || t("ui.property.roomFallback")}</p>
        <Button type="button" variant="link" className="mt-1 h-auto p-0" onClick={() => setDetailsOpen(true)}>{t("ui.hotel.roomDetails")}</Button>
        {!soldOut && offer.left <= 3 && <p className="mt-1 text-xs font-bold text-destructive">{t("ui.property.onlyLeft", { count: offer.left })}</p>}
      </div>
      <div className="flex flex-col items-start justify-between gap-3 sm:items-end sm:text-right">
        <div>
          <ReferencePrice amountMYR={Number(room.base_price)} className="font-[family-name:var(--font-mono)] text-xl font-bold text-primary" />
          <p className="text-xs text-muted-foreground">{t("ui.property.perNight")}</p>
          <p className="mt-1 text-xs font-semibold text-foreground">
            {t("ui.hotel.totalFor", { count: stay.nights, rooms: stay.rooms })} <ReferencePrice amountMYR={offer.total * stay.rooms} />
          </p>
        </div>
        {error && <p role="alert" className="text-xs font-semibold text-destructive">{error}</p>}
        <Button type="button" onClick={() => void book()} disabled={soldOut || working}>
          {soldOut ? t("ui.property.soldOut") : working ? t("ui.outletMenu.adding") : t("ui.property.book")}
        </Button>
      </div>
      <RoomDetailsDialog room={room} open={detailsOpen} onOpenChange={setDetailsOpen} onSelect={() => { setDetailsOpen(false); void book(); }} />
    </article>
  );
}

/** Fixed hotel layout (D1): every accommodation outlet looks the same; only its profile content differs. */
export function HotelPage({ outlet, rooms, gallery }: { outlet: OutletRendererOutlet; rooms: OutletRendererProduct[]; gallery: GalleryItem[] }) {
  const { t } = useTranslation("customer");
  const gate = useCustomerCapabilityGate();
  const { savedOutletIds, toggleSavedOutlet } = useWishlist();
  const saved = savedOutletIds.has(outlet.id);
  const stay = outlet.stay!;
  const address = outlet.address || [outlet.city, outlet.state].filter(Boolean).join(", ");
  const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([outlet.name, outlet.address, outlet.city, outlet.state].filter(Boolean).join(", "))}`;
  const sections = [
    ["rooms", t("ui.property.rooms")],
    ...(stay.about ? [["about", t("ui.hotel.about")]] : []),
    ...(stay.amenities.length ? [["amenities", t("ui.hotel.amenities")]] : []),
    ["policies", t("ui.property.policies")],
    ["location", t("ui.hotel.location")],
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-6 sm:pb-16 lg:px-8">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-foreground">{outlet.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {stay.reviews > 0 && <span className="inline-flex items-center gap-1 font-semibold text-foreground"><Star size={14} fill="var(--highlight-yellow)" stroke="none" aria-hidden="true" />{stay.rating.toFixed(1)}<span className="font-normal text-muted-foreground">{t("ui.hotel.reviewCount", { count: stay.reviews })}</span></span>}
            {address && <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden="true" />{address}</span>}
          </div>
        </div>
        <SaveToggleButton saved={saved} aria-label={saved ? t("ui.activity.removeSaved", { name: outlet.name }) : t("ui.activity.save", { name: outlet.name })}
          onClick={() => { if (gate(CUSTOMER_CAPABILITY.ACCOUNT_MUTATION)) void toggleSavedOutlet(outlet.id); }}>
          {saved ? t("ui.activity.removeSavedShort") : t("ui.activity.saveShort")}
        </SaveToggleButton>
      </header>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <label className="text-xs font-semibold text-muted-foreground">{t("ui.property.checkIn")}<Input type="date" name="checkin" defaultValue={stay.checkIn} required className="mt-1" /></label>
        <label className="text-xs font-semibold text-muted-foreground">{t("ui.property.checkOut")}<Input type="date" name="checkout" defaultValue={stay.checkOut} required className="mt-1" /></label>
        <label className="text-xs font-semibold text-muted-foreground">{t("ui.property.roomCount")}<Input type="number" name="rooms" min={1} max={10} defaultValue={stay.rooms} className="mt-1 w-20" /></label>
        <label className="text-xs font-semibold text-muted-foreground">{t("ui.property.adults")}<Input type="number" name="adults" min={1} max={20} defaultValue={stay.adults} className="mt-1 w-20" /></label>
        <Button type="submit">{t("ui.property.search")}</Button>
        <p className="basis-full text-xs text-muted-foreground">{t("ui.property.nightsSummary", { count: stay.nights })}</p>
      </form>

      {gallery.length > 0 && (
        <div className="mb-6">
          <MediaGallery items={gallery} label={t("ui.outlet.galleryLabel", { outlet: outlet.name })} previousLabel={t("ui.outlet.previousGallery")} nextLabel={t("ui.outlet.nextGallery")} slideLabel={t("ui.outlet.gallerySlide")} roleDescription={t("ui.accessibility.carousel")} />
        </div>
      )}

      <nav aria-label={t("ui.property.sections")} className="sticky top-0 z-20 -mx-4 mb-6 flex gap-5 overflow-x-auto border-b border-border bg-background/95 px-4 py-3 text-sm font-semibold backdrop-blur sm:-mx-6 sm:px-6">
        {sections.map(([id, label]) => <a key={id} href={`#${id}`} className="whitespace-nowrap text-primary hover:underline">{label}</a>)}
      </nav>

      <section id="rooms" className="scroll-mt-16">
        <h2 className="mb-4 text-2xl font-bold tracking-tight text-foreground">{t("ui.property.rooms")}</h2>
        <div className="space-y-4">{rooms.map((room) => <RoomCard key={room.id} outlet={outlet} room={room} />)}</div>
      </section>

      {stay.about && (
        <section id="about" className="mt-10 scroll-mt-16 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-xl font-bold text-foreground">{t("ui.hotel.about")}</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{stay.about}</p>
        </section>
      )}

      {stay.amenities.length > 0 && (
        <section id="amenities" className="mt-6 scroll-mt-16 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-xl font-bold text-foreground">{t("ui.hotel.amenities")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {stay.amenities.map((amenity) => <Badge key={amenity.code} variant="secondary" className="gap-1"><Check size={12} aria-hidden="true" />{amenity.label}</Badge>)}
          </div>
        </section>
      )}

      <section id="policies" className="mt-6 scroll-mt-16 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-xl font-bold text-foreground">{t("ui.property.policies")}</h2>
        {(stay.checkInTime || stay.checkOutTime) && (
          <p className="mt-2 text-sm text-muted-foreground">{t("ui.property.times", { checkIn: stay.checkInTime ?? "—", checkOut: stay.checkOutTime ?? "—" })}</p>
        )}
        {stay.policies && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{stay.policies}</p>}
      </section>

      <section id="location" className="mt-6 scroll-mt-16 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-xl font-bold text-foreground">{t("ui.hotel.location")}</h2>
        {address && <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground"><MapPin size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />{address}</p>}
        <Button asChild variant="outline" className="mt-3">
          <a href={mapHref} target="_blank" rel="noreferrer"><Navigation size={15} aria-hidden="true" />{t("ui.actions.getDirections")}<ArrowUpRight size={15} aria-hidden="true" /></a>
        </Button>
      </section>
    </div>
  );
}
