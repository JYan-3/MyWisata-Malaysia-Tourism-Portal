import { describe, expect, it } from "vitest";
import { hotelProfileChanges } from "@/components/admin/hotel-profile-diff";

const live = {
  name: "Pelangi Beach Resort & Spa", address: "Pantai Cenang", city: "Langkawi", state: "Kedah", phone: "+604",
  hotel_about: "Old about", amenity_codes: ["wifi"], check_in_time: "15:00:00", check_out_time: "12:00:00", stay_policies: "No pets.",
};

describe("hotel profile changes", () => {
  it("lists only the fields the hotel changed, comparing live columns with the proposal", () => {
    const changes = hotelProfileChanges(live, {
      about: "New about", amenityCodes: ["wifi", "swimming_pool"], checkInTime: "15:00", checkOutTime: "11:00",
      policies: "No pets.", photos: [], name: "Pelangi Beach Resort & Spa",
    });
    expect(changes).toEqual([
      { field: "about", before: "Old about", after: "New about" },
      { field: "amenities", before: "wifi", after: "wifi, swimming_pool" },
      { field: "checkOut", before: "12:00", after: "11:00" },
    ]);
  });

  it("reports a photo list and a renamed hotel", () => {
    const changes = hotelProfileChanges(live, {
      about: "Old about", amenityCodes: ["wifi"], checkInTime: "15:00", checkOutTime: "12:00", policies: "No pets.",
      photos: ["https://x/a.jpg", "https://x/b.jpg"], name: "Pelangi Resort",
    });
    expect(changes).toEqual([
      { field: "name", before: "Pelangi Beach Resort & Spa", after: "Pelangi Resort" },
      { field: "photos", before: "", after: "2" },
    ]);
  });
});
