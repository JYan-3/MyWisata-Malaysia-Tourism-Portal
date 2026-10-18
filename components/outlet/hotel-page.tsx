"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, BedDouble, Check, MapPin, Maximize2, Minus, Navigation, Plus, Star, Users } from "lucide-react";
import type { GalleryItem, OutletRendererOutlet, OutletRendererProduct } from "@/components/outlet/outlet-block-types";
import type { ProductReview, StayBookingDetails } from "@/backend/core/types";
import { RoomDetailsDialog } from "@/components/outlet/room-details-dialog";
import { StayGuestDetailsDialog } from "@/components/customer/stay-guest-details-dialog";
import { MediaGallery } from "@/components/customer/media-gallery";
import { ReferencePrice } from "@/components/shared/reference-price";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCart } from "@/components/providers/cart";
import { useWishlist } from "@/components/providers/wishlist";
import { SaveToggleButton } from "@/components/customer/save-toggle-button";
import { useAppDialog } from "@/components/providers/app-dialog";
import { useCustomerCapabilityGate } from "@/components/customer/use-customer-capability-gate";
import { CUSTOMER_CAPABILITY } from "@/lib/auth/customer-capabilities";

function RoomCard({ outlet, room }: { outlet: OutletRendererOutlet; room: OutletRendererProduct }) {
  const { t } = useTranslation("customer");
  const gate = useCustomerCapabilityGate();
  const { addItem, selectedKeys, setSelectedKeys } = useCart();
  const { alert } = useAppDialog();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [guestDialogOpen, setGuestDialogOpen] = useState(false);
  const [guestDialogKey, setGuestDialogKey] = useState(0);
  const stay = outlet.stay!;
  const offer = room.stay!;
  const soldOut = offer.left < stay.rooms || !offer.checkInSlotId;
  const photo = offer.photos[0];

  function openGuestDetails() {
    if (soldOut || !gate(CUSTOMER_CAPABILITY.CART_MUTATION)) return;
    setGuestDialogKey((key) => key + 1);
    setGuestDialogOpen(true);
  }

  async function addStayToCart(guestDetails: StayBookingDetails) {
    const line = { activityId: room.id, variantId: room.variant_id ?? "", slotId: offer.checkInSlotId!, outletId: outlet.id, nights: stay.nights };
    const key = await addItem({ ...line, qty: stay.rooms, priceOverride: offer.total, stayDetails: guestDetails });
    setSelectedKeys([...selectedKeys, key]);
    setGuestDialogOpen(false);
    await alert(t("ui.property.stayAdded"));
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
        <Button type="button" onClick={openGuestDetails} disabled={soldOut}>
          {soldOut ? t("ui.property.soldOut") : t("ui.property.book")}
        </Button>
      </div>
      <RoomDetailsDialog room={room} open={detailsOpen} onOpenChange={setDetailsOpen} onSelect={() => { setDetailsOpen(false); openGuestDetails(); }} />
      <StayGuestDetailsDialog key={guestDialogKey} open={guestDialogOpen} onOpenChange={setGuestDialogOpen} adults={stay.adults} onSave={addStayToCart} />
    </article>
  );
}

/** Fixed hotel layout (D1): every accommodation outlet looks the same; only its profile content differs. */
export function HotelPage({ outlet, rooms, gallery, reviews = [] }: { outlet: OutletRendererOutlet; rooms: OutletRendererProduct[]; gallery: GalleryItem[]; reviews?: ProductReview[] }) {
  const { t } = useTranslation("customer");
  const gate = useCustomerCapabilityGate();
  const { savedOutletIds, toggleSavedOutlet } = useWishlist();
  const [roomCount, setRoomCount] = useState(outlet.stay!.rooms);
  const [adultCount, setAdultCount] = useState(outlet.stay!.adults);
  const saved = savedOutletIds.has(outlet.id);
  const stay = outlet.stay!;
  const address = outlet.address || [outlet.city, outlet.state].filter(Boolean).join(", ");
  const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([outlet.name, outlet.address, outlet.city, outlet.state].filter(Boolean).join(", "))}`;
  const lowestRoomPrice = rooms.length ? Math.min(...rooms.map((room) => Number(room.base_price)).filter(Number.isFinite)) : null;
  const hasOverview = Boolean(stay.about || stay.amenities.length || stay.checkInTime || stay.checkOutTime);
  const hasReviews = stay.reviews > 0 || reviews.length > 0;
  const sections = [
    ["rooms", t("ui.property.rooms")],
    ...(hasOverview ? [["overview", t("ui.hotel.overview")]] : []),
    ...(hasReviews ? [["reviews", t("ui.hotel.reviews")]] : []),
    ...(stay.policies || stay.checkInTime || stay.checkOutTime ? [["policies", t("ui.property.policies")]] : []),
    ...(address ? [["location", t("ui.hotel.location")]] : []),
  ];

  function changeRoomCount(delta: number) {
    const next = Math.min(10, Math.max(1, roomCount + delta));
    setRoomCount(next);
    setAdultCount((current) => Math.max(current, next));
  }

  function changeAdultCount(delta: number) {
    setAdultCount((current) => Math.min(20, Math.max(roomCount, current + delta)));
  }

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
      <form method="get" aria-label={t("ui.hotel.yourStay")} className="mb-6 grid gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm lg:grid-cols-[minmax(12rem,1.1fr)_minmax(18rem,1.5fr)_minmax(16rem,1.2fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("ui.hotel.property")}</p>
          <p className="mt-1 truncate font-semibold text-foreground">{outlet.name}</p>
          <p className="truncate text-sm text-muted-foreground">{address}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-muted-foreground">{t("ui.property.checkIn")}<Input type="date" name="checkin" defaultValue={stay.checkIn} required className="mt-1" /></label>
          <label className="text-xs font-semibold text-muted-foreground">{t("ui.property.checkOut")}<Input type="date" name="checkout" defaultValue={stay.checkOut} required className="mt-1" /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{t("ui.hotel.roomsAndGuests")}</p>
            <div className="mt-1 flex min-h-9 items-center gap-2 rounded-md border border-input px-2">
              <Button type="button" size="icon" variant="outline" aria-label={t("ui.hotel.fewerRooms")} disabled={roomCount <= 1} onClick={() => changeRoomCount(-1)}><Minus size={14} aria-hidden="true" /></Button>
              <span className="min-w-14 text-center text-sm font-medium text-foreground">{t("ui.property.roomsCount", { count: roomCount })}</span>
              <Button type="button" size="icon" variant="outline" aria-label={t("ui.hotel.moreRooms")} disabled={roomCount >= 10} onClick={() => changeRoomCount(1)}><Plus size={14} aria-hidden="true" /></Button>
              <Input type="hidden" name="rooms" value={roomCount} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{t("ui.hotel.adults")}</p>
            <div className="mt-1 flex min-h-9 items-center gap-2 rounded-md border border-input px-2">
              <Button type="button" size="icon" variant="outline" aria-label={t("ui.hotel.fewerAdults")} disabled={adultCount <= roomCount} onClick={() => changeAdultCount(-1)}><Minus size={14} aria-hidden="true" /></Button>
              <span className="min-w-14 text-center text-sm font-medium text-foreground">{t("ui.hotel.adultsCount", { count: adultCount })}</span>
              <Button type="button" size="icon" variant="outline" aria-label={t("ui.hotel.moreAdults")} disabled={adultCount >= 20} onClick={() => changeAdultCount(1)}><Plus size={14} aria-hidden="true" /></Button>
              <Input type="hidden" name="adults" value={adultCount} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 lg:flex-col lg:items-stretch">
          <Button type="submit">{t("ui.property.search")}</Button>
          <p className="text-xs text-muted-foreground">{t("ui.property.nightsSummary", { count: stay.nights })}</p>
        </div>
      </form>

      {gallery.length > 0 && (
        <div className="mb-6">
          <MediaGallery items={gallery} label={t("ui.outlet.galleryLabel", { outlet: outlet.name })} previousLabel={t("ui.outlet.previousGallery")} nextLabel={t("ui.outlet.nextGallery")} slideLabel={t("ui.outlet.gallerySlide")} roleDescription={t("ui.accessibility.carousel")} />
        </div>
      )}

      <nav aria-label={t("ui.property.sections")} className="sticky top-0 z-20 -mx-4 mb-6 flex items-center gap-5 overflow-x-auto border-b border-border bg-background/95 px-4 py-3 text-sm font-semibold backdrop-blur sm:-mx-6 sm:px-6">
        {sections.map(([id, label]) => <a key={id} href={`#${id}`} className="whitespace-nowrap text-primary hover:underline">{label}</a>)}
        {lowestRoomPrice !== null && Number.isFinite(lowestRoomPrice) && <div className="ml-auto hidden shrink-0 items-center gap-3 sm:flex"><span><span className="mr-1 text-xs font-normal text-muted-foreground">{t("ui.hotel.from")}</span><ReferencePrice amountMYR={lowestRoomPrice} className="font-semibold text-foreground" /></span><Button asChild size="sm"><a href="#rooms">{t("ui.hotel.selectRoom")}</a></Button></div>}
      </nav>

      <section id="rooms" className="scroll-mt-16">
        <h2 className="mb-4 text-2xl font-bold tracking-tight text-foreground">{t("ui.property.rooms")}</h2>
        <div className="space-y-4">{rooms.map((room) => <RoomCard key={room.id} outlet={outlet} room={room} />)}</div>
      </section>

      {hasOverview && (
        <section id="overview" className="mt-10 scroll-mt-16 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-xl font-bold text-foreground">{t("ui.hotel.overview")}</h2>
          {stay.about && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{stay.about}</p>}
          {(stay.checkInTime || stay.checkOutTime) && <p className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-muted-foreground">{stay.checkInTime && <span><strong className="text-foreground">{t("ui.property.checkIn")}:</strong> {stay.checkInTime}</span>}{stay.checkOutTime && <span><strong className="text-foreground">{t("ui.property.checkOut")}:</strong> {stay.checkOutTime}</span>}</p>}
          {stay.amenities.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold text-foreground">{t("ui.hotel.amenities")}</h3><div className="mt-2 flex flex-wrap gap-2">{stay.amenities.map((amenity) => <Badge key={amenity.code} variant="secondary" className="gap-1"><Check size={12} aria-hidden="true" />{amenity.label}</Badge>)}</div></div>}
        </section>
      )}

      {hasReviews && (
        <section id="reviews" className="mt-6 scroll-mt-16 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-xl font-bold text-foreground">{t("ui.hotel.reviews")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("ui.hotel.reviewCount", { count: stay.reviews })}</p></div>
            {stay.rating > 0 && <p className="inline-flex items-center gap-1 font-semibold text-foreground"><Star size={15} fill="var(--highlight-yellow)" stroke="none" aria-hidden="true" />{stay.rating.toFixed(1)} / 5</p>}
          </div>
          {reviews.length > 0 ? <div className="mt-4 grid gap-3 md:grid-cols-2">{reviews.map((review) => <article key={review.id} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-3"><p className="font-semibold text-foreground">{review.authorName}</p><span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground"><Star size={13} fill="var(--highlight-yellow)" stroke="none" aria-hidden="true" />{review.rating.toFixed(1)}</span></div>
            {review.title && <h3 className="mt-2 font-semibold text-foreground">{review.title}</h3>}
            {review.body && <p className="mt-1 text-sm leading-6 text-muted-foreground">{review.body}</p>}
            {review.verifiedPurchase && <p className="mt-3 text-xs font-semibold text-primary">{t("ui.reviews.verifiedPurchase")}</p>}
          </article>)}</div> : <p className="mt-4 text-sm text-muted-foreground">{t("ui.hotel.noWrittenReviews")}</p>}
        </section>
      )}

      {(stay.policies || stay.checkInTime || stay.checkOutTime) && <section id="policies" className="mt-6 scroll-mt-16 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-xl font-bold text-foreground">{t("ui.property.policies")}</h2>
        {(stay.checkInTime || stay.checkOutTime) && <p className="mt-2 text-sm text-muted-foreground">{t("ui.property.times", { checkIn: stay.checkInTime ?? "—", checkOut: stay.checkOutTime ?? "—" })}</p>}
        {stay.policies && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{stay.policies}</p>}
      </section>}

      {address && <section id="location" className="mt-6 scroll-mt-16 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-xl font-bold text-foreground">{t("ui.hotel.location")}</h2>
        {address && <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground"><MapPin size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />{address}</p>}
        <Button asChild variant="outline" className="mt-3">
          <a href={mapHref} target="_blank" rel="noreferrer"><Navigation size={15} aria-hidden="true" />{t("ui.actions.getDirections")}<ArrowUpRight size={15} aria-hidden="true" /></a>
        </Button>
      </section>}
    </div>
  );
}
