import { describe, expect, it } from "vitest";
import { hasRoomDetails, readRoomDetails } from "../room-details";

describe("room details", () => {
  it("reads every room attribute and maps roomAmenities to amenities", () => {
    const details = readRoomDetails({
      bedType: "1 king bed or 2 twin beds",
      maxGuests: 3,
      sizeSqm: 46.5,
      view: "Sea view",
      smoking: "non_smoking",
      roomAmenities: ["Free Wi-Fi", "Electronic safe"],
      numberOfRooms: 12,
    });
    expect(details).toEqual({
      bedType: "1 king bed or 2 twin beds",
      maxGuests: 3,
      sizeSqm: 46.5,
      view: "Sea view",
      smoking: "non_smoking",
      amenities: ["Free Wi-Fi", "Electronic safe"],
    });
    expect(hasRoomDetails(details)).toBe(true);
  });

  it.each([{}, null, undefined, "x", 42, []])("treats %j as a room with no details", (input) => {
    const details = readRoomDetails(input);
    expect(details).toEqual({ amenities: [] });
    expect(hasRoomDetails(details)).toBe(false);
  });

  it("drops values of the wrong type instead of throwing", () => {
    expect(readRoomDetails({
      bedType: "  ",
      maxGuests: "2",
      sizeSqm: -5,
      view: 7,
      smoking: "sometimes",
      roomAmenities: ["Free Wi-Fi", "", 3, null],
    })).toEqual({ amenities: ["Free Wi-Fi"] });
  });
});
