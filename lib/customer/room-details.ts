/** Room-type details shown in the hotel page room popup, read from `products.attributes`. */
export type RoomDetails = {
  bedType?: string;
  maxGuests?: number;
  sizeSqm?: number;
  view?: string;
  smoking?: "non_smoking" | "smoking";
  amenities: string[];
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);

/** Never throws: missing or wrongly typed fields are dropped so a room with no data still renders. */
export function readRoomDetails(attributes: unknown): RoomDetails {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return { amenities: [] };
  const source = attributes as Record<string, unknown>;
  const details: RoomDetails = {
    bedType: text(source.bedType),
    maxGuests: positive(source.maxGuests),
    sizeSqm: positive(source.sizeSqm),
    view: text(source.view),
    smoking: source.smoking === "non_smoking" || source.smoking === "smoking" ? source.smoking : undefined,
    amenities: Array.isArray(source.roomAmenities) ? source.roomAmenities.map(text).filter((item): item is string => Boolean(item)) : [],
  };
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as RoomDetails;
}

export function hasRoomDetails(details: RoomDetails): boolean {
  return Boolean(details.bedType || details.maxGuests || details.sizeSqm || details.view || details.smoking || details.amenities.length);
}
