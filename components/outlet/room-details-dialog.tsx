"use client";

import { useTranslation } from "react-i18next";
import { BedDouble, Check, CigaretteOff, Eye, Maximize2, Users } from "lucide-react";
import type { OutletRendererProduct } from "@/components/outlet/outlet-block-types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Photos and facts for one room type; rows with no data are not rendered. */
export function RoomDetailsContent({ room }: { room: OutletRendererProduct }) {
  const { t } = useTranslation("customer");
  const details = room.stay?.details ?? { amenities: [] };
  const photos = room.stay?.photos ?? [];
  const facts = [
    details.bedType && { icon: BedDouble, label: t("ui.hotel.bed"), value: details.bedType },
    details.maxGuests && { icon: Users, label: t("ui.hotel.sleeps"), value: String(details.maxGuests) },
    details.sizeSqm && { icon: Maximize2, label: t("ui.hotel.size"), value: `${details.sizeSqm} m²` },
    details.view && { icon: Eye, label: t("ui.hotel.view"), value: details.view },
    details.smoking === "non_smoking" && { icon: CigaretteOff, label: t("ui.hotel.nonSmoking"), value: "" },
  ].filter((fact): fact is { icon: typeof BedDouble; label: string; value: string } => Boolean(fact));

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 self-start">
          {photos.map((url, index) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={url} src={url} alt={t("ui.hotel.photoAlt", { room: room.name, index: index + 1 })} className={`w-full rounded-xl object-cover ${index === 0 ? "col-span-2 aspect-[4/3]" : "aspect-square"}`} />
          ))}
        </div>
      )}
      <div className={`space-y-4 text-sm ${photos.length ? "" : "sm:col-span-2"}`}>
        {room.description && <p className="leading-6 text-muted-foreground">{room.description}</p>}
        {facts.length > 0 && (
          <dl className="space-y-2">
            {facts.map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-2">
                <Icon size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <dt className="font-semibold text-foreground">{label}</dt>
                {value && <dd className="text-muted-foreground">{value}</dd>}
              </div>
            ))}
          </dl>
        )}
        {details.amenities.length > 0 && (
          <div>
            <p className="mb-2 font-semibold text-foreground">{t("ui.hotel.roomAmenities")}</p>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {details.amenities.map((amenity) => (
                <li key={amenity} className="flex items-start gap-1.5 text-muted-foreground">
                  <Check size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                  {amenity}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function RoomDetailsDialog({ room, open, onOpenChange, onSelect }: { room: OutletRendererProduct; open: boolean; onOpenChange(open: boolean): void; onSelect(): void }) {
  const { t } = useTranslation("customer");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>{room.name}</DialogTitle>
        <DialogDescription className="sr-only">{t("ui.hotel.roomDetails")}</DialogDescription>
        <RoomDetailsContent room={room} />
        <DialogFooter>
          <Button type="button" onClick={onSelect}>{t("ui.hotel.selectThisRoom")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
