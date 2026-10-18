"use client";

import { useTranslation } from "react-i18next";

type LiveHotel = Record<string, unknown> | null | undefined;
type ProposedHotel = Record<string, unknown> | null | undefined;
export type HotelProfileChange = { field: string; before: string; after: string };

const text = (value: unknown) => (Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value));
const time = (value: unknown) => text(value).slice(0, 5);

/** Changed fields only, comparing the live outlet columns with the submitted profile. */
export function hotelProfileChanges(live: LiveHotel, proposed: ProposedHotel): HotelProfileChange[] {
  if (!proposed) return [];
  const before = live ?? {};
  const rows: HotelProfileChange[] = [
    { field: "name", before: text(before.name), after: proposed.name === undefined ? text(before.name) : text(proposed.name) },
    { field: "address", before: text(before.address), after: proposed.address === undefined ? text(before.address) : text(proposed.address) },
    { field: "city", before: text(before.city), after: proposed.city === undefined ? text(before.city) : text(proposed.city) },
    { field: "state", before: text(before.state), after: proposed.state === undefined ? text(before.state) : text(proposed.state) },
    { field: "phone", before: text(before.phone), after: proposed.phone === undefined ? text(before.phone) : text(proposed.phone) },
    { field: "about", before: text(before.hotel_about), after: text(proposed.about) },
    { field: "amenities", before: text(before.amenity_codes), after: text(proposed.amenityCodes) },
    { field: "checkIn", before: time(before.check_in_time), after: time(proposed.checkInTime) },
    { field: "checkOut", before: time(before.check_out_time), after: time(proposed.checkOutTime) },
    { field: "policies", before: text(before.stay_policies), after: text(proposed.policies) },
  ];
  const photos = Array.isArray(proposed.photos) ? proposed.photos.length : 0;
  if (photos) rows.push({ field: "photos", before: "", after: String(photos) });
  return rows.filter((row) => row.field === "photos" || row.before !== row.after);
}

export function HotelProfileDiff({ live, proposed }: { live: LiveHotel; proposed: ProposedHotel }) {
  const { t } = useTranslation("admin");
  const changes = hotelProfileChanges(live, proposed);
  return (
    <div className="rounded-xl bg-muted p-4">
      <p className="text-xs text-muted-foreground">{t("catalogue.hotelDiff.title")}</p>
      {changes.length === 0 ? (
        <p className="mt-1 text-foreground">{t("catalogue.hotelDiff.noChanges")}</p>
      ) : (
        <dl className="mt-2 space-y-3">
          {changes.map((change) => (
            <div key={change.field}>
              <dt className="text-xs font-semibold text-foreground">{t(`catalogue.hotelDiff.fields.${change.field}`)}</dt>
              {change.field === "photos" ? (
                <dd className="text-foreground">{t("catalogue.hotelDiff.photoCount", { count: Number(change.after) })}</dd>
              ) : (
                <dd className="grid gap-1 sm:grid-cols-2">
                  <span className="whitespace-pre-line text-muted-foreground line-through">{change.before || "—"}</span>
                  <span className="whitespace-pre-line text-foreground">{change.after || "—"}</span>
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
