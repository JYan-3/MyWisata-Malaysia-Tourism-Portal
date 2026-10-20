-- Pelangi Beach Resort & Spa, Langkawi: hotel profile and room details for the hotel page pilot.
-- Facts come from the resort's official website (pelangiresort.com), written in our own words.
-- source: https://www.pelangiresort.com/ (6 food and beverage outlets incl. all-day dining at Spice Market, spa, chalet-style rooms)
-- source: https://www.pelangiresort.com/faq (check-in 3.00pm, check-out 12.00pm, no pets, no smoking in rooms,
--         third-person supplement MYR350 nett incl. daybed and breakfast, not for family rooms, pools 8am-8pm, laundry service)
-- source: https://www.pelangiresort.com/garden-terrace-room (46.5 sqm, king or twin beds, 2 adults + 2 children under 12 or 3 adults)
-- source: https://www.pelangiresort.com/seaview (46.5 sqm, king or twin beds, sea view, bathtub with separate rain shower)
-- source: https://www.pelangiresort.com/garden-family-room (55 sqm, king bed + single bed, steps from the pool)
-- Room mapping (D11, no renames): Garden Room = official Garden Terrace; Beachfront Room = official Seaview;
-- Pelangi Garden Family Room = official Garden Family Room.
-- Photos: no openly licensed Pelangi photos exist on Wikimedia Commons, so existing cover photos are kept.
-- Prices: the official site publishes no room rates, so no price is changed.

UPDATE public.outlets
SET hotel_about = 'A beachfront resort on Pantai Cenang, Langkawi, with 355 rooms and suites in wooden chalets set among tropical gardens and lakes. Guests have two swimming pools, six places to eat and drink including all-day dining at Spice Market, sunset bars and a spa using local herbs.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'restaurant', 'breakfast', 'laundry'],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not permitted. Smoking, including e-cigarettes, is not allowed in rooms; use the balcony ashtrays or outdoor smoking areas. A third guest aged 4 and above is charged MYR350 nett per night, including a daybed and breakfast, with a maximum of 1 extra bed per room; this does not apply to family rooms. Pools are open 8am to 8pm, and children under 12 must be accompanied by an adult.'
WHERE id = '5016d273-eb84-d20d-81ab-f9022bf401fa';

-- Garden Room (official: Garden Terrace)
UPDATE public.products
SET description = 'A wooden chalet room with a private verandah looking out over quiet tropical gardens.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{
      "bedType": "1 king bed or 2 twin beds",
      "maxGuests": 3,
      "sizeSqm": 46.5,
      "view": "Garden view from a private verandah",
      "smoking": "non_smoking",
      "roomAmenities": ["Separate rain shower", "Bathroom with vanity area", "Filtered drinking water", "Coffee and tea making", "Daily housekeeping", "Electronic safe", "Minibar (chargeable)", "Free Wi-Fi", "24-hour in-room dining"]
    }'::jsonb
WHERE id = 'ceb8d447-c612-a82f-95de-c034396724f5';

-- Beachfront Room (official: Seaview)
UPDATE public.products
SET description = 'A breezy chalet room facing the sea, with ocean views through the palm trees.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{
      "bedType": "1 king bed or 2 twin beds",
      "maxGuests": 3,
      "sizeSqm": 46.5,
      "view": "Sea view",
      "smoking": "non_smoking",
      "roomAmenities": ["Bathtub with separate rain shower", "Bathroom with vanity area", "Filtered drinking water", "Coffee and tea making", "Daily housekeeping", "Electronic safe", "Minibar (chargeable)", "Free Wi-Fi", "24-hour in-room dining"]
    }'::jsonb
WHERE id = 'a264a6d5-b5fc-f7e0-ccb4-57aceed4e792';

-- Pelangi Garden Family Room (official: Garden Family Room)
UPDATE public.products
SET description = 'A spacious family room a few steps from the pool, for 2 adults and 2 children under 12.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{
      "bedType": "1 king bed and 1 single bed",
      "maxGuests": 4,
      "sizeSqm": 55,
      "view": "Steps from the pool",
      "smoking": "non_smoking",
      "roomAmenities": ["Bathtub with separate rain shower", "Bathroom with vanity area", "Filtered drinking water", "Coffee and tea making", "Daily housekeeping", "Electronic safe", "Minibar (chargeable)", "Free Wi-Fi", "24-hour in-room dining"]
    }'::jsonb
WHERE id = '94a35c65-b139-4eea-ab4f-76cd72f1a622';
