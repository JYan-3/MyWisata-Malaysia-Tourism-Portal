-- Hotel profile, room details and photos for every hotel (plan docs/plans/2026-10-19-1801-hotel-data-fill.md).
-- FYP demo data. Facts come from each hotel's official site where one exists, in our own words; anything
-- marked `invented for demo` is made up to fit the hotel's type and location.
-- Photos: Wikimedia Commons photos of the hotel itself where they exist, otherwise freely licensed photos of
-- a similar hotel (Unsplash / Pexels / Commons). Licence and source page are listed above each photo set.
-- Room names, prices and room cover photos are unchanged.

-- ===== Baba House =====
-- source (about): https://www.babahouse.com.my/
-- source (amenities): https://www.babahouse.com.my/
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: Official site gives no check-in/out times or policies; times follow common listings (15:00/12:00). No openly licensed photos of the hotel itself exist; photos show the Baba & Nyonya Heritage Museum and shophouses on the same heritage street. Hibiscus view based on guest reports of small windows.
UPDATE public.outlets
SET hotel_about = 'A heritage hotel in a row of restored Peranakan townhouses on Jalan Tun Tan Cheng Lock, inside Melaka''s UNESCO-listed old town and a few doors from Jonker Walk and the Stadthuys. Guests can eat Nyonya dishes at Mari Chiak Restaurant, relax at the Kaki Minom rooftop bar beside a small rooftop pool, use the gym and browse Peranakan books in the hotel library.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'restaurant', 'swimming_pool', 'gym']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and smoking is not permitted anywhere inside the heritage building. Deluxe and Deluxe Plus rooms take a maximum of 2 adults, so extra beds cannot be added. A refundable security deposit is collected at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '2e229147-c689-87d0-0b56-4146a8e1c9e2';

-- Deluxe Plus King (Bilek Ruellia King) -- source: https://www.babahouse.com.my/rooms_Ruellia.html
UPDATE public.products
SET description = 'A Deluxe Plus room with oasis-style contemporary furnishings, a standing shower and space for two adults.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 2, "sizeSqm": 22, "view": "Heritage street view (balcony in selected rooms)", "smoking": "non_smoking", "roomAmenities": ["Standing shower", "Free high-speed internet", "Coffee and tea making", "In-room safe", "Cable TV", "Hairdryer", "Mini refrigerator"]}'::jsonb
WHERE id = '1f10ff04-2057-451a-a01c-07ea228937d7';

-- Deluxe Twin (Bilek Hibiscus) -- source: https://www.babahouse.com.my/rooms_hibiscus.html
UPDATE public.products
SET description = 'A compact Deluxe room tucked inside the heritage townhouse, simply furnished for two guests.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 2, "sizeSqm": 17, "view": "Inward-facing room with a small window", "smoking": "non_smoking", "roomAmenities": ["Standing shower", "Free high-speed internet", "Coffee and tea making", "In-room safe", "Cable TV", "Hairdryer", "Mini refrigerator"]}'::jsonb
WHERE id = '0377b6ad-bf3d-42a8-a288-7d915d7b4e3b';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Baba_and_Nyonya_House_Museum_Exterior.jpg
-- photo 2 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:2016_Malakka,_Stary_zdobiony_dom_na_ulicy_Jonker_(03).jpg
-- photo 3 (similar hotel, CC BY 4.0): https://commons.wikimedia.org/wiki/File:Baba_Nyonya_Heritage_Museum_-_Reception_Hall.jpg
-- photo 4 (similar hotel, CC BY 4.0): https://commons.wikimedia.org/wiki/File:Baba_Nyonya_Heritage_Museum_-_Bed.jpg
DELETE FROM public.media_assets WHERE outlet_id = '2e229147-c689-87d0-0b56-4146a8e1c9e2' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('1b3a8768-f6a3-8ca3-89fe-fb0f14389baf', '2e229147-c689-87d0-0b56-4146a8e1c9e2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Baba_and_Nyonya_House_Museum_Exterior.jpg/1280px-Baba_and_Nyonya_House_Museum_Exterior.jpg', 'image', -1, 'Ornate Peranakan townhouse facade on Jalan Tun Tan Cheng Lock, Melaka'),
  ('1b3a8768-f6a3-8ca3-89fe-fb0f14389baf', '2e229147-c689-87d0-0b56-4146a8e1c9e2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Baba_and_Nyonya_House_Museum_Exterior.jpg/1280px-Baba_and_Nyonya_House_Museum_Exterior.jpg', 'image', 0, 'Ornate Peranakan townhouse facade on Jalan Tun Tan Cheng Lock, Melaka'),
  ('1b3a8768-f6a3-8ca3-89fe-fb0f14389baf', '2e229147-c689-87d0-0b56-4146a8e1c9e2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/2016_Malakka%2C_Stary_zdobiony_dom_na_ulicy_Jonker_%2803%29.jpg/1280px-2016_Malakka%2C_Stary_zdobiony_dom_na_ulicy_Jonker_%2803%29.jpg', 'image', 1, 'Carved wooden doors and plaster details on an old Melaka shophouse'),
  ('1b3a8768-f6a3-8ca3-89fe-fb0f14389baf', '2e229147-c689-87d0-0b56-4146a8e1c9e2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/Baba_Nyonya_Heritage_Museum_-_Reception_Hall.jpg/1280px-Baba_Nyonya_Heritage_Museum_-_Reception_Hall.jpg', 'image', 2, 'Peranakan reception hall with carved blackwood furniture and painted screens'),
  ('1b3a8768-f6a3-8ca3-89fe-fb0f14389baf', '2e229147-c689-87d0-0b56-4146a8e1c9e2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Baba_Nyonya_Heritage_Museum_-_Bed.jpg/1280px-Baba_Nyonya_Heritage_Museum_-_Bed.jpg', 'image', 3, 'Traditional Peranakan canopy bed with carved gilded frame');

-- ===== Bala's Chalet =====
-- source (about): https://wanderlog.com/place/details/1877494
-- source (amenities): https://www.expedia.de/en/Tanah-Rata-Hotels-The-Balas-Holiday-Chalet.h8630099.Hotel-Information
-- source (check-in/out): https://www.expedia.de/en/Tanah-Rata-Hotels-The-Balas-Holiday-Chalet.h8630099.Hotel-Information
-- source (policies): https://www.expedia.de/en/Tanah-Rata-Hotels-The-Balas-Holiday-Chalet.h8630099.Hotel-Information
-- note: Listed on booking sites as The Bala's Holiday Chalet (also seen as Planters Country Hotel). No official website found; facts from booking listings. Room mapping: Deluxe/Superior = Superior Double, Family Room = Family Suite, Suite = Raffles Suite; Tudor Chalet Room details invented. Room sizes estimated. No Commons photos of the hotel; photos show Tanah Rata area and similar rooms.
UPDATE public.outlets
SET hotel_about = 'A cosy English country-style guesthouse on a hillside just outside Tanah Rata, housed in a 1930s building that once served as a boarding school for expatriate children. Rooms look over flower gardens, and the in-house Planters Tea House serves breakfast, lunch and dinner with a homely highland feel.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'free_parking']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed. Guests must be 18 or older to check in, and a cash or card deposit is collected for incidentals. The building has no lifts, and late check-out is possible for a fee, subject to availability.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'f0e0df5f-d420-d282-2215-d69c1ca69ec4';

-- Deluxe Room -- source: https://www.expedia.de/en/Tanah-Rata-Hotels-The-Balas-Holiday-Chalet.h8630099.Hotel-Information
UPDATE public.products
SET description = 'A bright double room with timber details and a window over the chalet gardens.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 20, "view": "Garden view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Electric kettle with tea and coffee", "Heater", "Extra blankets", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '13d3ac25-3bb9-4a45-a8a7-797d43622929';

-- Family Room -- source: https://www.expedia.de/en/Tanah-Rata-Hotels-The-Balas-Holiday-Chalet.h8630099.Hotel-Information
UPDATE public.products
SET description = 'A family suite with room for four, ideal for parents with children on a highland holiday.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 32, "view": "Garden view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Electric kettle with tea and coffee", "Heater", "Extra blankets", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'e0176cd1-e8df-4006-af55-bcdc0643e967';

-- Suite -- source: https://www.expedia.de/en/Tanah-Rata-Hotels-The-Balas-Holiday-Chalet.h8630099.Hotel-Information
UPDATE public.products
SET description = 'The Raffles Suite, the chalet''s largest room, with a separate sitting corner and garden outlook.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 38, "view": "Garden and hillside view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Electric kettle with tea and coffee", "Heater", "Extra blankets", "Free Wi-Fi", "Daily housekeeping", "Sitting area"]}'::jsonb
WHERE id = '5c386611-30bf-4b19-a33a-2f1d0ee65a37';

-- Superior Room -- source: https://www.expedia.de/en/Tanah-Rata-Hotels-The-Balas-Holiday-Chalet.h8630099.Hotel-Information
UPDATE public.products
SET description = 'A simple, comfortable double room with an en-suite hot shower, good for couples.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed", "maxGuests": 2, "sizeSqm": 16, "view": "Garden or courtyard view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Electric kettle with tea and coffee", "Heater", "Extra blankets", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'e74030ae-fe21-4fe5-aa1c-637719948893';

-- Tudor Chalet Room -- source: invented for demo
UPDATE public.products
SET description = 'A charming room in the Tudor-style wing with exposed beams and old-world furnishings.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 22, "view": "Garden view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Electric kettle with tea and coffee", "Heater", "Extra blankets", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '18b87c52-b063-6530-52b8-cef16818c074';

-- photo 1 (similar hotel, CC BY 4.0): https://commons.wikimedia.org/wiki/File:Tanah_Rata,_Pahang,_Malaysia.jpg
-- photo 2 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Escoy_Suite,_Cheong_Fatt_Tze_Mansion,_Penang,_Malaysia_-_20101114.jpg
-- photo 3 (similar hotel, CC BY-SA 2.0): https://commons.wikimedia.org/wiki/File:Cameron_Valley_Tea_Estate_-_Near_Tanah_Rata_-_Cameron_Highlands_-_Malaysia_-_03_(35374803022).jpg
-- photo 4 (similar hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Room_at_the_Amari_Hotel_(7476652362).jpg
DELETE FROM public.media_assets WHERE outlet_id = 'f0e0df5f-d420-d282-2215-d69c1ca69ec4' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('88413c38-187d-ccd4-86e8-c705a11b45ac', 'f0e0df5f-d420-d282-2215-d69c1ca69ec4', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Tanah_Rata%2C_Pahang%2C_Malaysia.jpg/1280px-Tanah_Rata%2C_Pahang%2C_Malaysia.jpg', 'image', -1, 'Hillside view over Tanah Rata town in the Cameron Highlands'),
  ('88413c38-187d-ccd4-86e8-c705a11b45ac', 'f0e0df5f-d420-d282-2215-d69c1ca69ec4', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Tanah_Rata%2C_Pahang%2C_Malaysia.jpg/1280px-Tanah_Rata%2C_Pahang%2C_Malaysia.jpg', 'image', 0, 'Hillside view over Tanah Rata town in the Cameron Highlands'),
  ('88413c38-187d-ccd4-86e8-c705a11b45ac', 'f0e0df5f-d420-d282-2215-d69c1ca69ec4', 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Escoy_Suite%2C_Cheong_Fatt_Tze_Mansion%2C_Penang%2C_Malaysia_-_20101114.jpg', 'image', 1, 'Colonial-style guest bedroom with timber floors and a four-poster bed'),
  ('88413c38-187d-ccd4-86e8-c705a11b45ac', 'f0e0df5f-d420-d282-2215-d69c1ca69ec4', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Cameron_Valley_Tea_Estate_-_Near_Tanah_Rata_-_Cameron_Highlands_-_Malaysia_-_03_%2835374803022%29.jpg/1280px-Cameron_Valley_Tea_Estate_-_Near_Tanah_Rata_-_Cameron_Highlands_-_Malaysia_-_03_%2835374803022%29.jpg', 'image', 2, 'Rolling tea bushes at a tea estate near Tanah Rata'),
  ('88413c38-187d-ccd4-86e8-c705a11b45ac', 'f0e0df5f-d420-d282-2215-d69c1ca69ec4', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Room_at_the_Amari_Hotel_%287476652362%29.jpg/1280px-Room_at_the_Amari_Hotel_%287476652362%29.jpg', 'image', 3, 'Cosy hotel room with a double bed and two armchairs by the window');

-- ===== Best Western =====
-- source (about): https://au.hotels.com/ho486725/best-western-i-city-shah-alam-shah-alam-malaysia
-- source (amenities): https://www.nst.com.my/amp/property/2024/12/1150463/i-berhad-inks-deal-hotel-group-wyndham-garden-i-city
-- source (check-in/out): https://www.agoda.com/best-western-i-city-shah-alam_7/hotel/shah-alam-my.html
-- source (policies): invented for demo
-- note: The Best Western i-City Shah Alam has been rebranded as Wyndham Garden i-City Shah Alam (deal reported Dec 2024); filled as the same property. Official site details unavailable, so room data is invented to fit a mid-range city hotel. Photo 2 may show the hotel tower itself but is not confirmed, so isActualHotel=false.
UPDATE public.outlets
SET hotel_about = 'A modern 214-room city hotel inside the i-City development in Shah Alam, right beside the Federal Highway and within walking distance of Central i-City mall and the i-City theme park with its famous light displays. Guests have an all-day dining restaurant, a fitness room, free Wi-Fi and free parking, making it a handy base for both business trips and family weekends in Selangor.',
    amenity_codes = ARRAY['wifi', 'free_parking', 'restaurant', 'breakfast', 'gym', 'front_desk_24h', 'laundry', 'air_conditioning']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all rooms are non-smoking. One extra bed can be added to Deluxe rooms and Suites for a nightly fee; children under 6 sharing existing beds stay free. A refundable security deposit is collected by card or cash at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '1b185c90-349d-8bee-fda5-48f656f16e03';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A larger room on a higher floor with a seating corner and views towards the i-City park.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 3, "sizeSqm": 28, "view": "i-City and city view", "smoking": "non_smoking", "roomAmenities": ["Rain shower", "Seating corner", "Work desk", "Flat-screen TV", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '009a1605-8239-d361-3938-0429ed11ec39';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A roomy family room with two queen beds, ideal for parents with two children visiting the theme park.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 36, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Flat-screen TV", "Coffee and tea making", "Mini fridge", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'dc932273-3615-4f83-a4bd-f07f8feeecec';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'A one-bedroom suite with a separate living area and bathtub, on an upper floor overlooking i-City.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 48, "view": "i-City park view", "smoking": "non_smoking", "roomAmenities": ["Separate living area", "Bathtub and shower", "Work desk", "Two flat-screen TVs", "Coffee machine", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = 'e6dd7a58-0658-a6ee-de55-4150af821575';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A compact, modern room with a work desk, suited to business travellers or couples on a short stay.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Rain shower", "Work desk", "Flat-screen TV", "Coffee and tea making", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '8b38d3ab-0a1e-4f49-acb4-76a46316ad0a';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:BeCentral%26Wyndham_i-City.jpg
-- photo 2 (similar hotel, Unsplash License): https://unsplash.com/photos/modern-hotel-building-with-palm-trees-and-lush-greenery-AfKCwCF-SaU
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/a-cozy-bedroom-with-a-king-size-bed-and-blue-accents-A0-Gkbema_w
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/modern-hotel-lobby-with-sleek-reception-desk-and-seating-Accg0bUgp7k
DELETE FROM public.media_assets WHERE outlet_id = '1b185c90-349d-8bee-fda5-48f656f16e03' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('efc205b3-e2e7-0500-980e-39e00c4ae045', '1b185c90-349d-8bee-fda5-48f656f16e03', 'https://upload.wikimedia.org/wikipedia/commons/7/74/BeCentral%26Wyndham_i-City.jpg', 'image', -1, 'Residential and hotel towers at i-City, Shah Alam, seen from Central i-City'),
  ('efc205b3-e2e7-0500-980e-39e00c4ae045', '1b185c90-349d-8bee-fda5-48f656f16e03', 'https://upload.wikimedia.org/wikipedia/commons/7/74/BeCentral%26Wyndham_i-City.jpg', 'image', 0, 'Residential and hotel towers at i-City, Shah Alam, seen from Central i-City'),
  ('efc205b3-e2e7-0500-980e-39e00c4ae045', '1b185c90-349d-8bee-fda5-48f656f16e03', 'https://images.unsplash.com/photo-1757840357512-eaeb60d4d353?w=1280&q=80', 'image', 1, 'Modern multi-storey hotel facade with palm trees and garden in front'),
  ('efc205b3-e2e7-0500-980e-39e00c4ae045', '1b185c90-349d-8bee-fda5-48f656f16e03', 'https://images.unsplash.com/photo-1770232274485-b35ee5092cbe?w=1280&q=80', 'image', 2, 'Cosy hotel bedroom with a king-size bed and blue accents'),
  ('efc205b3-e2e7-0500-980e-39e00c4ae045', '1b185c90-349d-8bee-fda5-48f656f16e03', 'https://images.unsplash.com/photo-1758193783649-13371d7fb8dd?w=1280&q=80', 'image', 3, 'Modern hotel lobby with a sleek reception desk and seating');

-- ===== Casa del Mar =====
-- source (about): https://www.casadelmar-langkawi.com/
-- source (amenities): https://www.casadelmar-langkawi.com/
-- source (check-in/out): https://www.hotels.com/ho196837
-- source (policies): invented for demo
-- note: Room mapping: Beachfront Suite = official Beachfront Studio Suite; Deluxe Room = Seaview Studio Suite; Family Room = Seaview Junior/Deluxe Suite (70 sqm per a third-party listing); Sea View Room = Seaview Room; Superior Room has no official equivalent and is invented. Booking sites report the resort closed 1 May-30 Sep 2026 for a seasonal break. Room sizes are estimates except the 42 sqm studio and 70 sqm deluxe suite.
UPDATE public.outlets
SET hotel_about = 'A small, Mediterranean-style boutique hotel right on the sand at Pantai Cenang, Langkawi, with sea-facing rooms and studio suites. Guests unwind at the beachside pool and La Sal pool bar, dine on modern Western and local dishes at La Sal Restaurant, and book treatments at the in-house Satkara Spa.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'restaurant', 'breakfast', 'laundry', 'airport_transfer']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all rooms are non-smoking. Children are welcome; one extra bed can be added to suites for a nightly charge. A credit card or cash deposit is taken at check-in for incidentals, and guests arriving after 6pm should let the hotel know in advance.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '4b934eec-6827-a9a9-5f44-08ebe3756401';

-- Beachfront Suite -- source: https://www.casadelmar-langkawi.com/
UPDATE public.products
SET description = 'A studio suite on the ground floor with a private courtyard that opens straight onto the beach.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 45, "view": "Beachfront with direct beach access", "smoking": "non_smoking", "roomAmenities": ["Private courtyard with daybed", "Rain shower", "Air conditioning", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'fc3834a0-f573-0cff-1e1e-162e337e0723';

-- Deluxe Room -- source: https://www.casadelmar-langkawi.com/
UPDATE public.products
SET description = 'A studio suite with a courtyard daybed looking over the pool towards the beach.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 42, "view": "Pool and beach view", "smoking": "non_smoking", "roomAmenities": ["Courtyard daybed", "Rain shower", "Air conditioning", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '1278e8fe-3066-4405-ae81-1b637cddfa85';

-- Family Room -- source: https://www.casadelmar-langkawi.com/
UPDATE public.products
SET description = 'An upper-floor suite with a separate lounge, two sea-facing balconies and a sofa bed for families.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 sofa bed", "maxGuests": 4, "sizeSqm": 70, "view": "Sea view from two balconies", "smoking": "non_smoking", "roomAmenities": ["Separate living area", "Two balconies with hammock", "Bathtub and rain shower", "Air conditioning", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '4bab1063-7a7d-43e5-a042-96d2481d59cc';

-- Sea View Room -- source: https://www.casadelmar-langkawi.com/
UPDATE public.products
SET description = 'A bright room with a private balcony looking straight out over Pantai Cenang and the sea.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 2, "sizeSqm": 36, "view": "Sea view from a private balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "Rain shower", "Air conditioning", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '91e1fcff-0964-e710-67d6-9b815b8bbd90';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A cosy Mediterranean-style room set back from the beach, close to the pool and restaurant.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 twin beds", "maxGuests": 2, "sizeSqm": 32, "view": "Garden and partial pool view", "smoking": "non_smoking", "roomAmenities": ["Rain shower", "Air conditioning", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = 'fc8921cc-f82d-427e-ae4d-cbecd3cef0b9';

-- photo 1 (this hotel, CC BY 3.0): https://commons.wikimedia.org/wiki/File:Casa_del_Mar_Langkawi_-_panoramio.jpg
-- photo 2 (this hotel, CC BY 3.0): https://commons.wikimedia.org/wiki/File:Casa_del_mar_restaurant_-_panoramio.jpg
-- photo 3 (this hotel, CC BY 3.0): https://commons.wikimedia.org/wiki/File:Casa_Del_Mar_Langkawi,Seaview_from_the_restaurant_-_panoramio.jpg
-- photo 4 (this hotel, CC BY 3.0): https://commons.wikimedia.org/wiki/File:Evening_sun_from_Casa_del_Mar_Langkawi_-_panoramio.jpg
DELETE FROM public.media_assets WHERE outlet_id = '4b934eec-6827-a9a9-5f44-08ebe3756401' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('378b9ec4-e22e-7640-e18d-19d652caf9eb', '4b934eec-6827-a9a9-5f44-08ebe3756401', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Casa_del_Mar_Langkawi_-_panoramio.jpg/1280px-Casa_del_Mar_Langkawi_-_panoramio.jpg', 'image', -1, 'Still pool lined with palm trees, with the beach and Langkawi hills beyond'),
  ('378b9ec4-e22e-7640-e18d-19d652caf9eb', '4b934eec-6827-a9a9-5f44-08ebe3756401', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Casa_del_Mar_Langkawi_-_panoramio.jpg/1280px-Casa_del_Mar_Langkawi_-_panoramio.jpg', 'image', 0, 'Still pool lined with palm trees, with the beach and Langkawi hills beyond'),
  ('378b9ec4-e22e-7640-e18d-19d652caf9eb', '4b934eec-6827-a9a9-5f44-08ebe3756401', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Casa_del_mar_restaurant_-_panoramio.jpg/1280px-Casa_del_mar_restaurant_-_panoramio.jpg', 'image', 1, 'Beachfront dining terrace with tables under palm trees facing the sea'),
  ('378b9ec4-e22e-7640-e18d-19d652caf9eb', '4b934eec-6827-a9a9-5f44-08ebe3756401', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Casa_Del_Mar_Langkawi%2CSeaview_from_the_restaurant_-_panoramio.jpg/1280px-Casa_Del_Mar_Langkawi%2CSeaview_from_the_restaurant_-_panoramio.jpg', 'image', 2, 'Open-sided lounge looking out over the pool and sea'),
  ('378b9ec4-e22e-7640-e18d-19d652caf9eb', '4b934eec-6827-a9a9-5f44-08ebe3756401', 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Evening_sun_from_Casa_del_Mar_Langkawi_-_panoramio.jpg/1280px-Evening_sun_from_Casa_del_Mar_Langkawi_-_panoramio.jpg', 'image', 3, 'Sunset over the sea framed by palm fronds');

-- ===== Courtyard@Heeren =====
-- source (about): https://courtyardatheeren.com/the-hotel/
-- source (amenities): https://courtyardatheeren.com/the-hotel/
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: Official site lists no twin room; Heeren Shophouse Twin mapped to the official Superior Room, with twin beds and size invented. Hotel count is 14 rooms per the-hotel page (15 in press). No openly licensed photos of the hotel; photos show nearby Melaka heritage shophouses and a generic twin room.
UPDATE public.outlets
SET hotel_about = 'A small boutique hotel of 14 rooms and suites at 91 Jalan Tun Tan Cheng Lock, the old Heeren Street of Melaka''s Chinatown, about a minute''s walk from Jonker Street. Its award-winning design blends Peranakan shophouse details with modern comfort, each room has its own decorative theme, and all come with rain showers and air-conditioning.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'breakfast']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not permitted and smoking is not allowed in rooms or the courtyard. Children are welcome, and family rooms or the Family Suite (up to 8 guests) suit larger groups; extra beds can be arranged on request for a fee. There is no on-site car park, so guests use nearby public parking.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '685ceaa2-3da4-7321-196b-73fe946e07f5';

-- Heeren Shophouse Twin -- source: https://courtyardatheeren.com/rooms-rates/superior-room/
UPDATE public.products
SET description = 'A themed shophouse room with two single beds, Peranakan touches and a rain shower, steps from Jonker Street.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 2, "sizeSqm": 20, "view": "Inner courtyard view", "smoking": "non_smoking", "roomAmenities": ["Rain shower", "32-inch LCD TV", "Coffee and tea making", "Complimentary mineral water", "Hairdryer", "In-room safe", "Minibar fridge", "Individually controlled air-conditioning"]}'::jsonb
WHERE id = '66f41300-f61f-33f2-d0e0-bc396245dec0';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:2016_Malakka,_Stary_zdobiony_dom_na_ulicy_Jonker_(07).jpg
-- photo 2 (similar hotel, Public domain): https://commons.wikimedia.org/wiki/File:Jonker_Street(Curio%27s_and_antiques%27)Melaka.JPG
-- photo 3 (similar hotel, CC BY-SA 2.0): https://commons.wikimedia.org/wiki/File:Inside_the_Baba_and_Nyonya_Heritage_Museum.jpg
-- photo 4 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Twin_room.jpg
DELETE FROM public.media_assets WHERE outlet_id = '685ceaa2-3da4-7321-196b-73fe946e07f5' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('c1be30fc-a45f-754d-2268-a571ccb3f79b', '685ceaa2-3da4-7321-196b-73fe946e07f5', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/2016_Malakka%2C_Stary_zdobiony_dom_na_ulicy_Jonker_%2807%29.jpg/1280px-2016_Malakka%2C_Stary_zdobiony_dom_na_ulicy_Jonker_%2807%29.jpg', 'image', -1, 'Colourful heritage shophouse facade with arched shutters in Melaka Chinatown'),
  ('c1be30fc-a45f-754d-2268-a571ccb3f79b', '685ceaa2-3da4-7321-196b-73fe946e07f5', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/2016_Malakka%2C_Stary_zdobiony_dom_na_ulicy_Jonker_%2807%29.jpg/1280px-2016_Malakka%2C_Stary_zdobiony_dom_na_ulicy_Jonker_%2807%29.jpg', 'image', 0, 'Colourful heritage shophouse facade with arched shutters in Melaka Chinatown'),
  ('c1be30fc-a45f-754d-2268-a571ccb3f79b', '685ceaa2-3da4-7321-196b-73fe946e07f5', 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Jonker_Street%28Curio%27s_and_antiques%27%29Melaka.JPG/1280px-Jonker_Street%28Curio%27s_and_antiques%27%29Melaka.JPG', 'image', 1, 'Quiet lane of old shophouses near Jonker Street, Melaka'),
  ('c1be30fc-a45f-754d-2268-a571ccb3f79b', '685ceaa2-3da4-7321-196b-73fe946e07f5', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Inside_the_Baba_and_Nyonya_Heritage_Museum.jpg/1280px-Inside_the_Baba_and_Nyonya_Heritage_Museum.jpg', 'image', 2, 'Carved Peranakan screen doors inside a Melaka townhouse'),
  ('c1be30fc-a45f-754d-2268-a571ccb3f79b', '685ceaa2-3da4-7321-196b-73fe946e07f5', 'https://upload.wikimedia.org/wikipedia/commons/7/70/Twin_room.jpg', 'image', 3, 'Hotel twin room with two single beds and warm red furnishings');

-- ===== DJ Citi Point Hotel =====
-- source (about): https://www.expedia.co.uk/Kuala-Terengganu-Hotels-DJ-Citi-Point-Hotel.h8296184.Hotel-Information
-- source (amenities): https://www.expedia.co.uk/Kuala-Terengganu-Hotels-DJ-Citi-Point-Hotel.h8296184.Hotel-Information
-- source (check-in/out): https://www.expedia.co.uk/Kuala-Terengganu-Hotels-DJ-Citi-Point-Hotel.h8296184.Hotel-Information
-- source (policies): https://www.expedia.co.uk/Kuala-Terengganu-Hotels-DJ-Citi-Point-Hotel.h8296184.Hotel-Information
-- note: No official website found; facts from booking listings. Room mapping: Superior = Standard Superior/Basic Double, Deluxe = Deluxe Triple, Family = Family Room; Suite is invented (no suite listed). Family room is small (about 20 sqm per listing). No Commons photos of the hotel; photos show a similar Kuala Terengganu hotel, the area and a similar room.
UPDATE public.outlets
SET hotel_about = 'A small budget hotel in central Kuala Terengganu, a short walk from Kampung Cina and Pasar Payang. It offers simple air-conditioned rooms over two floors, free Wi-Fi, a 24-hour front desk and parking, with airport and ferry jetty shuttles available at extra cost.',
    amenity_codes = ARRAY['wifi', 'front_desk_24h', 'free_parking', 'air_conditioning', 'airport_transfer']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'All rooms are non-smoking and pets are not allowed. Breakfast is not served on site. A refundable deposit of about MYR50 may be collected at check-in, and extra beds are not offered.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '9684426e-5272-5c3e-866c-62f6ec2965f6';

-- Deluxe Room -- source: https://www.expedia.co.uk/Kuala-Terengganu-Hotels-DJ-Citi-Point-Hotel.h8296184.Hotel-Information
UPDATE public.products
SET description = 'A roomy deluxe triple with space for three, suited to small groups exploring the old town.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 1 single bed", "maxGuests": 3, "sizeSqm": 25, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV", "Blackout curtains", "Private bathroom", "Rain shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '7fe56dfd-c47a-04a3-510f-6c28d1cbc80f';

-- Family Room -- source: https://www.expedia.co.uk/Kuala-Terengganu-Hotels-DJ-Citi-Point-Hotel.h8296184.Hotel-Information
UPDATE public.products
SET description = 'A practical family room for four with two beds and a private bathroom.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 20, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV", "Blackout curtains", "Private bathroom", "Rain shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'a6847aaa-80cb-452b-a3cf-9eaffe570fb6';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'The hotel''s largest room, with a separate sleeping area and space to relax after a day out.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 30, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV", "Blackout curtains", "Private bathroom", "Rain shower", "Free Wi-Fi", "Daily housekeeping", "Seating area"]}'::jsonb
WHERE id = '81f014d7-dbb7-4900-e22f-7873ec2fa7cf';

-- Superior Room -- source: https://www.expedia.co.uk/Kuala-Terengganu-Hotels-DJ-Citi-Point-Hotel.h8296184.Hotel-Information
UPDATE public.products
SET description = 'A compact, tidy double room for budget travellers in the city centre.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 16, "view": "Inner or city view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV", "Blackout curtains", "Private bathroom", "Rain shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '00318453-0061-4f59-a00b-e7044497374e';

-- photo 1 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Kampung_Cina_Hotel,_Kuala_Terengganu_20240226_175457.jpg
-- photo 2 (similar hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Chinatown_Gate,_Kuala_Terengganu.jpg
-- photo 3 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Double_room_of_Conscious_Hotel_The_Tire_Staion_2024-11-26.jpg
-- photo 4 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Kuala_Terengganu_River_(February_2017).jpg
DELETE FROM public.media_assets WHERE outlet_id = '9684426e-5272-5c3e-866c-62f6ec2965f6' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('ac55b2b2-c9cf-9c83-90b1-f18c30069ffe', '9684426e-5272-5c3e-866c-62f6ec2965f6', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Kampung_Cina_Hotel%2C_Kuala_Terengganu_20240226_175457.jpg/1280px-Kampung_Cina_Hotel%2C_Kuala_Terengganu_20240226_175457.jpg', 'image', -1, 'Small three-storey hotel on a street in Kampung Cina, Kuala Terengganu'),
  ('ac55b2b2-c9cf-9c83-90b1-f18c30069ffe', '9684426e-5272-5c3e-866c-62f6ec2965f6', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Kampung_Cina_Hotel%2C_Kuala_Terengganu_20240226_175457.jpg/1280px-Kampung_Cina_Hotel%2C_Kuala_Terengganu_20240226_175457.jpg', 'image', 0, 'Small three-storey hotel on a street in Kampung Cina, Kuala Terengganu'),
  ('ac55b2b2-c9cf-9c83-90b1-f18c30069ffe', '9684426e-5272-5c3e-866c-62f6ec2965f6', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Chinatown_Gate%2C_Kuala_Terengganu.jpg/1280px-Chinatown_Gate%2C_Kuala_Terengganu.jpg', 'image', 1, 'Lit-up Chinatown gate in Kuala Terengganu at night'),
  ('ac55b2b2-c9cf-9c83-90b1-f18c30069ffe', '9684426e-5272-5c3e-866c-62f6ec2965f6', 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Double_room_of_Conscious_Hotel_The_Tire_Staion_2024-11-26.jpg/1280px-Double_room_of_Conscious_Hotel_The_Tire_Staion_2024-11-26.jpg', 'image', 2, 'Compact double room in a budget city hotel'),
  ('ac55b2b2-c9cf-9c83-90b1-f18c30069ffe', '9684426e-5272-5c3e-866c-62f6ec2965f6', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Kuala_Terengganu_River_%28February_2017%29.jpg/1280px-Kuala_Terengganu_River_%28February_2017%29.jpg', 'image', 3, 'Fishing boats on the Terengganu River');

-- ===== Eastern & Oriental Hotel =====
-- source (about): https://www.eohotels.com/
-- source (amenities): https://www.eohotels.com/facilities/
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: E&O offers suites only. Mapping: Superior Room = Heritage Wing Superior Suite; Deluxe Room = Heritage Wing Deluxe Suite; Heritage Wing Suite = Straits Suite; Victory Annexe Suite = Studio Suite (55 sqm, slightly smaller than the Deluxe Suite in reality); Family Room = Victory Annexe Corner Suite (sofa bed and 4-guest limit are a guess). Check-in/out times not on official site (third-party listing also says 15:00/12:00).
UPDATE public.outlets
SET hotel_about = 'A grand colonial-era hotel on the George Town seafront, founded by the Sarkies brothers in the 1880s and made up of the restored Heritage Wing and the newer Victory Annexe. Every room is a suite, and guests can enjoy two seaside pools, a fitness centre facing the Andaman Sea, afternoon tea at Palm Court, buffets at Sarkies and cocktails at Farquhar''s Bar.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'gym', 'restaurant', 'breakfast', 'front_desk_24h', 'laundry', 'air_conditioning']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not permitted, and smoking is not allowed in suites or indoor areas. Children of all ages are welcome; one extra bed per suite is available for a fee. A credit card or cash deposit is required at check-in to cover incidentals.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '2d044cc4-6ed2-d038-5629-45c1587c668a';

-- Deluxe Room -- source: https://www.eohotels.com/wing/heritage-wing/
UPDATE public.products
SET description = 'A Heritage Wing suite with a seating area beside large windows facing the Andaman Sea.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 58, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Seating area", "Bathtub and separate shower", "Twin vanity sinks", "UHD flat-screen TV", "Coffee machine", "Tea station", "Minibar (chargeable)", "Free Wi-Fi"]}'::jsonb
WHERE id = 'd92a0f61-a8da-45cc-a184-50c56e1d577a';

-- Family Room -- source: https://scandasia.com/celebrating-a-bygone-era-at-eastern-oriental-hotels-new-victory-annexe/
UPDATE public.products
SET description = 'A large Victory Annexe corner suite with a separate living room and sofa bed, good for families of four.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 sofa bed", "maxGuests": 4, "sizeSqm": 123, "view": "Panoramic sea view", "smoking": "non_smoking", "roomAmenities": ["Separate living room", "Sofa bed", "Bathtub and separate shower", "Two flat-screen TVs", "Coffee machine", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '03542209-ac96-4604-adc3-b434a186fa29';

-- Heritage Wing Suite -- source: https://www.eohotels.com/wing/heritage-wing/
UPDATE public.products
SET description = 'A spacious sea-facing suite with two bay windows, a living lounge, writing desk and dining table.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 87, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Living lounge with guest restroom", "Claw-foot bathtub and separate shower", "Writing desk", "Dining table", "UHD flat-screen TV", "Coffee machine", "Minibar (chargeable)", "Free Wi-Fi"]}'::jsonb
WHERE id = 'dc4310a5-d416-308e-9492-2b6aa2df3427';

-- Superior Room -- source: https://www.eohotels.com/wing/heritage-wing/
UPDATE public.products
SET description = 'A Heritage Wing suite with separate bedroom and living area, looking over the streets of George Town.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 57, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Separate living area", "Bathtub and separate shower", "Twin vanity sinks", "UHD flat-screen TV", "Coffee machine", "Tea station", "Minibar (chargeable)", "Free Wi-Fi"]}'::jsonb
WHERE id = '8db76615-81c7-4fd9-a542-65cff0a104be';

-- Victory Annexe Suite -- source: https://scandasia.com/celebrating-a-bygone-era-at-eastern-oriental-hotels-new-victory-annexe/
UPDATE public.products
SET description = 'A modern studio suite in the Victory Annexe with sea views and classic colonial touches.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 55, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Bathtub and separate shower", "Seating area", "UHD flat-screen TV", "Coffee machine", "Tea station", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '95fcecae-0a40-dbf6-f72b-735f2d1d6e9a';

-- photo 1 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Eastern_%26_Oriental_Hotel_-_Penang.jpg
-- photo 2 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Cmglee_Penang_Eastern_and_Oriental_Hotel_pool.jpg
-- photo 3 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Eastern_%26_Oriental_Hotel_April_2025.jpg
-- photo 4 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Heritage_wing_of_Eastern_and_Oriental_hotel.jpg
DELETE FROM public.media_assets WHERE outlet_id = '2d044cc4-6ed2-d038-5629-45c1587c668a' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('07d07c86-9efa-a929-1135-91f1adeae68b', '2d044cc4-6ed2-d038-5629-45c1587c668a', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Eastern_%26_Oriental_Hotel_-_Penang.jpg/1280px-Eastern_%26_Oriental_Hotel_-_Penang.jpg', 'image', -1, 'White colonial facade of the Eastern & Oriental Hotel, George Town'),
  ('07d07c86-9efa-a929-1135-91f1adeae68b', '2d044cc4-6ed2-d038-5629-45c1587c668a', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Eastern_%26_Oriental_Hotel_-_Penang.jpg/1280px-Eastern_%26_Oriental_Hotel_-_Penang.jpg', 'image', 0, 'White colonial facade of the Eastern & Oriental Hotel, George Town'),
  ('07d07c86-9efa-a929-1135-91f1adeae68b', '2d044cc4-6ed2-d038-5629-45c1587c668a', 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Cmglee_Penang_Eastern_and_Oriental_Hotel_pool.jpg/1280px-Cmglee_Penang_Eastern_and_Oriental_Hotel_pool.jpg', 'image', 1, 'Seafront pool area of the Eastern & Oriental Hotel'),
  ('07d07c86-9efa-a929-1135-91f1adeae68b', '2d044cc4-6ed2-d038-5629-45c1587c668a', 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Eastern_%26_Oriental_Hotel_April_2025.jpg/1280px-Eastern_%26_Oriental_Hotel_April_2025.jpg', 'image', 2, 'The Victory Annexe wing of the Eastern & Oriental Hotel'),
  ('07d07c86-9efa-a929-1135-91f1adeae68b', '2d044cc4-6ed2-d038-5629-45c1587c668a', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Heritage_wing_of_Eastern_and_Oriental_hotel.jpg/1280px-Heritage_wing_of_Eastern_and_Oriental_hotel.jpg', 'image', 3, 'The Heritage Wing of the Eastern & Oriental Hotel');

-- ===== Excelsior Hotel =====
-- source (about): https://www.hotelexcelsior.com.my/
-- source (amenities): https://www.hotelexcelsior.com.my/
-- source (check-in/out): https://uk.hotels.com/ho479229/hotel-excelsior-ipoh-malaysia
-- source (policies): invented for demo
-- note: Official room list (sizes in sq ft): Superior 237, Deluxe 258, Family 431, Junior/Studio Suite 538; converted to sqm. Suite = Studio Suite; Family Room = Family Quadruple Room. The hotel has no Standard category, so Standard Room is invented. Check-in/out times are from Hotels.com because the official site does not state them. Photo 2 is a city panorama, not the hotel itself.
UPDATE public.outlets
SET hotel_about = 'A long-running four-star hotel on Jalan Sultan Abdul Jalil in central Ipoh, close to the old town''s food streets and colonial landmarks. Its 197 rooms and suites serve business and leisure guests, with the Dulang Coffee House for Malaysian and Western meals, Sonata Lounge, a gym, a ballroom, a business centre and an on-site car park.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'gym', 'free_parking', 'front_desk_24h', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all guest rooms are non-smoking. Children under 12 stay free using existing bedding, and an extra bed can be requested for a nightly charge. A refundable deposit is collected at check-in, and room service runs until 11:30pm.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'f33d1970-2f59-876d-0743-58cf528c9036';

-- Deluxe Room -- source: https://www.hotelexcelsior.com.my/
UPDATE public.products
SET description = 'A comfortable room on a higher floor with a work desk and views across the city.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 2, "sizeSqm": 24, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV with satellite channels", "Work desk", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi", "Hairdryer"]}'::jsonb
WHERE id = '6eb6ca76-9548-fbaa-bc06-b4494632b3f1';

-- Family Room -- source: https://www.hotelexcelsior.com.my/
UPDATE public.products
SET description = 'A large room for families with extra beds, sleeping up to four adults.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 40, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV with satellite channels", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi", "Hairdryer"]}'::jsonb
WHERE id = '8e350eb1-9837-4b4c-a127-a42818038eb2';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A simple, well-kept room with the essentials for a short city stay.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 20, "view": "City or inner view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV with satellite channels", "Coffee and tea making", "Electronic safe", "Free Wi-Fi", "Shower"]}'::jsonb
WHERE id = 'd484c588-ce97-7d8b-f832-ef749c65c071';

-- Suite -- source: https://www.hotelexcelsior.com.my/
UPDATE public.products
SET description = 'A studio-style suite with a sitting area, ideal for longer business or leisure stays.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 50, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Sitting area", "Bathtub and shower", "LCD TV with satellite channels", "Work desk", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi", "Bathrobes and slippers"]}'::jsonb
WHERE id = '3e37742b-2c82-4e7b-acb0-e5c4a292cf5e';

-- Superior Room -- source: https://www.hotelexcelsior.com.my/
UPDATE public.products
SET description = 'A compact room with a work desk, suited to couples or solo business travellers.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 22, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV with satellite channels", "Work desk", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = 'f534463f-ae43-405d-a39d-1e84a8851684';

-- photo 1 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Hotel_Excelsior,_Ipoh,_Malaysia.JPG
-- photo 2 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:ExcelsiorPano2.jpg
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/reception-desk-in-hotel-lobby-8BYahZcwYgI
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/Yrxr3bsPdS0
DELETE FROM public.media_assets WHERE outlet_id = 'f33d1970-2f59-876d-0743-58cf528c9036' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('86d0e607-c015-cba8-e1ad-0741ed0a5ce2', 'f33d1970-2f59-876d-0743-58cf528c9036', 'https://upload.wikimedia.org/wikipedia/commons/b/bb/Hotel_Excelsior%2C_Ipoh%2C_Malaysia.JPG', 'image', -1, 'Hotel Excelsior tower with its rooftop sign above shops in central Ipoh'),
  ('86d0e607-c015-cba8-e1ad-0741ed0a5ce2', 'f33d1970-2f59-876d-0743-58cf528c9036', 'https://upload.wikimedia.org/wikipedia/commons/b/bb/Hotel_Excelsior%2C_Ipoh%2C_Malaysia.JPG', 'image', 0, 'Hotel Excelsior tower with its rooftop sign above shops in central Ipoh'),
  ('86d0e607-c015-cba8-e1ad-0741ed0a5ce2', 'f33d1970-2f59-876d-0743-58cf528c9036', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/ExcelsiorPano2.jpg/1280px-ExcelsiorPano2.jpg', 'image', 1, 'Panoramic view over Ipoh city centre and limestone hills'),
  ('86d0e607-c015-cba8-e1ad-0741ed0a5ce2', 'f33d1970-2f59-876d-0743-58cf528c9036', 'https://images.unsplash.com/photo-1660557989695-14fac79c086d?w=1280&q=80', 'image', 2, 'Black marble hotel reception desk with gold trim'),
  ('86d0e607-c015-cba8-e1ad-0741ed0a5ce2', 'f33d1970-2f59-876d-0743-58cf528c9036', 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=1280&q=80', 'image', 3, 'Hotel room with a king bed, bedside lamps and a bed runner');

-- ===== Furama Hotel =====
-- source (about): https://us.trip.com/hotels/tupai-hotel-detail-25659293/hotel-furama-taiping/review.html
-- source (amenities): https://us.trip.com/hotels/tupai-hotel-detail-25659293/hotel-furama-taiping/review.html
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: No official website found; facts from booking-site listings and reviews (Trip.com). Times 14:00/12:00 match listings but are not from an official source. All room details invented (budget hotel). Guests report a nightclub/bistro next door and no lift. Photos are of Taiping town and generic rooms, not the hotel.
UPDATE public.outlets
SET hotel_about = 'A modest three-star hotel at 30 Jalan Peng Loong in central Taiping, within walking distance of the Taiping Lake Gardens and the town''s well-known hawker stalls. It offers simple air-conditioned rooms with hot showers, free private parking and a 24-hour front desk, making it a practical, good-value base for exploring Perak''s historic lake town.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'free_parking', 'front_desk_24h']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'The building has no lift, so guests with heavy luggage or limited mobility should ask for a lower floor. Smoking is not allowed in rooms and pets are not accepted. Breakfast is not included, but many hawker stalls and kopitiam are close by.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'e273d679-b53a-c5b6-28c0-b139f3b9a73e';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A brighter room with a queen bed, a small work desk and a window over the town.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 22, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Work desk", "Daily housekeeping", "Wardrobe"]}'::jsonb
WHERE id = 'f38bfbfc-3dc9-bd10-447c-6ddc467e628d';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with two double beds, handy for parents travelling with children.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 double beds", "maxGuests": 4, "sizeSqm": 28, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Daily housekeeping", "Wardrobe"]}'::jsonb
WHERE id = 'ef001057-f405-4b24-ae85-37990ba53f16';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A basic room for two with a double bed, air-conditioning and an en-suite hot shower.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed", "maxGuests": 2, "sizeSqm": 14, "view": "Inner view, some rooms without windows", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'ded88038-ed9e-9c9b-94f6-b03bfe28b6c7';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'The largest room, with a king bed, a sofa corner and extra space to unwind after a day in Taiping.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 35, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Sofa seating", "Work desk", "Daily housekeeping", "Mini fridge"]}'::jsonb
WHERE id = '8cb54d20-16f2-4180-abe3-3439a801e68e';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A slightly larger room with a choice of queen or twin beds, suited to couples or friends.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 18, "view": "Street view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Daily housekeeping", "Wardrobe"]}'::jsonb
WHERE id = '786a4fa0-3d17-4543-a910-3e76c42d25b4';

-- photo 1 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Taiping_Lake_Gardens_1.jpg
-- photo 2 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Taiping-night-view.jpg
-- photo 3 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Twin_bedroom.jpg
-- photo 4 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Room_pic.jpg
DELETE FROM public.media_assets WHERE outlet_id = 'e273d679-b53a-c5b6-28c0-b139f3b9a73e' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('76f96b8c-c40f-e6ec-dea1-1b4b1566860a', 'e273d679-b53a-c5b6-28c0-b139f3b9a73e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Taiping_Lake_Gardens_1.jpg/1280px-Taiping_Lake_Gardens_1.jpg', 'image', -1, 'Taman Tasik Taiping sign reflected in the lake at dusk'),
  ('76f96b8c-c40f-e6ec-dea1-1b4b1566860a', 'e273d679-b53a-c5b6-28c0-b139f3b9a73e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Taiping_Lake_Gardens_1.jpg/1280px-Taiping_Lake_Gardens_1.jpg', 'image', 0, 'Taman Tasik Taiping sign reflected in the lake at dusk'),
  ('76f96b8c-c40f-e6ec-dea1-1b4b1566860a', 'e273d679-b53a-c5b6-28c0-b139f3b9a73e', 'https://upload.wikimedia.org/wikipedia/commons/0/01/Taiping-night-view.jpg', 'image', 1, 'Aerial view of Taiping town lit up at night'),
  ('76f96b8c-c40f-e6ec-dea1-1b4b1566860a', 'e273d679-b53a-c5b6-28c0-b139f3b9a73e', 'https://upload.wikimedia.org/wikipedia/commons/c/c3/Twin_bedroom.jpg', 'image', 2, 'Simple twin room with two single beds and a standing fan'),
  ('76f96b8c-c40f-e6ec-dea1-1b4b1566860a', 'e273d679-b53a-c5b6-28c0-b139f3b9a73e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Room_pic.jpg/1280px-Room_pic.jpg', 'image', 3, 'Hotel bed made up with towel swans and cushions');

-- ===== Heritage Hotel Cameron Highlands =====
-- source (about): https://hotel.vliegwinkel.nl/hotel/my/heritage-cameron-highlands.en-gb.html
-- source (amenities): https://hotel.vliegwinkel.nl/hotel/my/heritage-cameron-highlands.en-gb.html
-- source (check-in/out): https://www.expedia.com.my/Tanah-Rata-Hotels-Heritage-Hotel-Cameron-Highlands.h2922010.Hotel-Information
-- source (policies): https://www.expedia.com.my/Tanah-Rata-Hotels-Heritage-Hotel-Cameron-Highlands.h2922010.Hotel-Information
-- note: No official website found (old listings point to heritage.com.my); facts from booking listings. Room mapping: Family Room = Deluxe Quad, Heritage Family Room = Deluxe Quad Junior Suite, Heritage Twin = Superior Twin. Sizes estimated. 'gym' chosen for the listed wellness centre/squash court.
UPDATE public.outlets
SET hotel_about = 'A large Tudor-style hotel on a hilltop at the edge of Tanah Rata, with around 230 rooms looking over the town and forested hills. Facilities include an indoor heated pool, the all-day Rainforest Restaurant, Jasmine Garden Chinese restaurant, a bar and lounge serving Cameron tea, a squash court and a kids'' playroom.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'restaurant', 'breakfast', 'free_parking', 'front_desk_24h', 'gym', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets and service animals are not allowed. A credit card is required at check-in for incidental charges. All rooms are non-smoking, and extra beds can be arranged for a fee, subject to availability.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '10e34127-c043-0701-11a7-56bab17b1685';

-- Deluxe Room -- source: https://hotel.vliegwinkel.nl/hotel/my/heritage-cameron-highlands.en-gb.html
UPDATE public.products
SET description = 'A room in the newer Deluxe Wing with a balcony, in-room safe and DVD player.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 2, "sizeSqm": 30, "view": "Hill or town view from a balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "LCD TV with cable channels", "Tea and coffee making", "Minibar", "Hot shower", "Free Wi-Fi", "Daily housekeeping", "In-room safe"]}'::jsonb
WHERE id = '08eab223-7a2e-4cb3-a5ae-8b1a608d231b';

-- Family Room -- source: https://ae.trip.com/hotels/tanah-rata-hotel-detail-698982/heritage-hotel-cameron-highlands
UPDATE public.products
SET description = 'A deluxe quad room for families, with two large beds and a balcony over the hills.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 36, "view": "Hill view from a balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "LCD TV with cable channels", "Tea and coffee making", "Minibar", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '34992f60-3f8a-4e26-a979-0c39f6223b4a';

-- Heritage Family Room -- source: https://ae.trip.com/hotels/tanah-rata-hotel-detail-698982/heritage-hotel-cameron-highlands
UPDATE public.products
SET description = 'A junior suite on the upper floor with extra living space, made for bigger families.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 5, "sizeSqm": 45, "view": "Panoramic hill view", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "LCD TV with cable channels", "Tea and coffee making", "Minibar", "Hot shower", "Free Wi-Fi", "Daily housekeeping", "Sitting area"]}'::jsonb
WHERE id = '0be146b3-f955-52fa-3b29-38e5674613c5';

-- Heritage Twin Room -- source: https://hotel.vliegwinkel.nl/hotel/my/heritage-cameron-highlands.en-gb.html
UPDATE public.products
SET description = 'A classic twin room with Tudor touches and a balcony overlooking Tanah Rata.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 2, "sizeSqm": 28, "view": "Town or hill view from a balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "LCD TV with cable channels", "Tea and coffee making", "Minibar", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '05d9514c-b272-8e53-57f7-09aac14897b7';

-- Superior Room -- source: https://hotel.vliegwinkel.nl/hotel/my/heritage-cameron-highlands.en-gb.html
UPDATE public.products
SET description = 'A cosy superior room in the original wing, ideal for couples on a cool-weather break.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 26, "view": "Garden or hill view", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "LCD TV with cable channels", "Tea and coffee making", "Minibar", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '0b464dc3-b36e-46bc-ae5c-251e365daea8';

-- photo 1 (this hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Heritage_Hotel_-_panoramio.jpg
-- photo 2 (this hotel, CC0): https://commons.wikimedia.org/wiki/File:Heritage_Hotel_Cameron_Highlands.JPG
-- photo 3 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Cameron_Highlands_Tea_Plantation_2012.JPG
-- photo 4 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Twin_room.jpg
DELETE FROM public.media_assets WHERE outlet_id = '10e34127-c043-0701-11a7-56bab17b1685' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('ec92a5c7-6a74-4412-90e5-c74945d71a2b', '10e34127-c043-0701-11a7-56bab17b1685', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Heritage_Hotel_-_panoramio.jpg/1280px-Heritage_Hotel_-_panoramio.jpg', 'image', -1, 'Tudor-style wings of Heritage Hotel on a green hillside in Tanah Rata'),
  ('ec92a5c7-6a74-4412-90e5-c74945d71a2b', '10e34127-c043-0701-11a7-56bab17b1685', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Heritage_Hotel_-_panoramio.jpg/1280px-Heritage_Hotel_-_panoramio.jpg', 'image', 0, 'Tudor-style wings of Heritage Hotel on a green hillside in Tanah Rata'),
  ('ec92a5c7-6a74-4412-90e5-c74945d71a2b', '10e34127-c043-0701-11a7-56bab17b1685', 'https://upload.wikimedia.org/wikipedia/commons/4/48/Heritage_Hotel_Cameron_Highlands.JPG', 'image', 1, 'Black-and-white Tudor gables of Heritage Hotel Cameron Highlands'),
  ('ec92a5c7-6a74-4412-90e5-c74945d71a2b', '10e34127-c043-0701-11a7-56bab17b1685', 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Cameron_Highlands_Tea_Plantation_2012.JPG/1280px-Cameron_Highlands_Tea_Plantation_2012.JPG', 'image', 2, 'Tea plantation valleys in the Cameron Highlands'),
  ('ec92a5c7-6a74-4412-90e5-c74945d71a2b', '10e34127-c043-0701-11a7-56bab17b1685', 'https://upload.wikimedia.org/wikipedia/commons/7/70/Twin_room.jpg', 'image', 3, 'Traditional twin room with two single beds and red bedspreads');

-- ===== Hilton Kuching =====
-- source (about): https://www.expedia.com/go/hotel/info/18804
-- source (amenities): https://www.expedia.com/go/hotel/info/18804
-- source (check-in/out): https://www.travelocity.com/Long-Banga-Hotels-Hilton-Kuching.h18804.Hotel-Information
-- source (policies): invented for demo
-- note: Official hilton.com returned 403; facts taken from Expedia/Travelocity listings. Executive Suite matches the listed 56 sqm Executive Suite (floors 11-13). Suite mapped to the river-view Sarawak Suite; its size is a guess. Photo 3 is a Hilton Kota Kinabalu twin room (similar hotel, not this one).
UPDATE public.outlets
SET hotel_about = 'A long-standing international hotel on Jalan Tunku Abdul Rahman in central Kuching, a short walk from the Kuching Waterfront, with many rooms looking over the Sarawak River. Facilities include an outdoor pool with a separate children''s pool and poolside bar, a fitness centre and several restaurants, among them Toh Yuen for Chinese cuisine.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'gym', 'restaurant', 'breakfast', 'front_desk_24h', 'laundry', 'air_conditioning', 'accessible']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Guests must be at least 18 to check in. Pets are not allowed and all rooms are non-smoking. Extra beds are available in larger rooms for a fee, and children under 12 sharing existing bedding stay free. A refundable deposit is held on a credit card at check-in.',
    wheelchair_accessible = true,
    pet_friendly = false
WHERE id = '1dbca93a-6bfe-af43-110b-591e4a795b34';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A guest room on a higher floor with views across the Sarawak River and the Astana.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 32, "view": "Sarawak River view", "smoking": "non_smoking", "roomAmenities": ["Bathtub with shower", "Work desk", "Flat-screen TV", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi", "Bathrobes and slippers"]}'::jsonb
WHERE id = '08b0f9a3-e61e-1d14-651d-17a95174f9f1';

-- Executive Suite -- source: https://www.travelocity.com/Long-Banga-Hotels-Hilton-Kuching.h18804.Hotel-Information
UPDATE public.products
SET description = 'A suite on the upper floors with a separate living area and access to executive lounge benefits.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 56, "view": "City or river view", "smoking": "non_smoking", "roomAmenities": ["Separate living area", "Bathtub and shower", "Refrigerator", "Minibar (chargeable)", "Flat-screen TV", "Coffee and tea making", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '8e016bd1-aa66-e4e1-3f43-ba4487b442ae';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with two double beds and space for two adults and two children.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 double beds", "maxGuests": 4, "sizeSqm": 38, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Bathtub with shower", "Flat-screen TV", "Coffee and tea making", "Mini fridge", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '272ff88d-a193-4329-ae63-226b13cc3c8e';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'A large signature suite with a lounge and dining area overlooking the Sarawak River.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 4, "sizeSqm": 90, "view": "Sarawak River view", "smoking": "non_smoking", "roomAmenities": ["Living and dining area", "Guest restroom", "Bathtub and separate shower", "Two flat-screen TVs", "Coffee machine", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '76f6dbb4-dbf4-4bc4-a635-5a0cb967bd7a';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A comfortable Hilton guest room with a work desk and city views, a short walk from the waterfront.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 2, "sizeSqm": 30, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Bathtub with shower", "Work desk", "Flat-screen TV", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = 'e9b1935a-cad2-46e2-aed6-44cdd3fbafc9';

-- photo 1 (this hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Hilton_Hotel_-_Kuching,_Malaysia.jpg
-- photo 2 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Hilton_Kuching.jpg
-- photo 3 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Twin_guest_room_Hilton_Kota_Kinabalu_20251207_182012.jpg
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/boats-on-river-with-distinctive-building-in-background-ZCNNcxY7AAY
DELETE FROM public.media_assets WHERE outlet_id = '1dbca93a-6bfe-af43-110b-591e4a795b34' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('7593ca5c-9847-75f0-cf57-db0ffefb10b3', '1dbca93a-6bfe-af43-110b-591e4a795b34', 'https://upload.wikimedia.org/wikipedia/commons/d/db/Hilton_Hotel_-_Kuching%2C_Malaysia.jpg', 'image', -1, 'Exterior of the Hilton Kuching hotel tower'),
  ('7593ca5c-9847-75f0-cf57-db0ffefb10b3', '1dbca93a-6bfe-af43-110b-591e4a795b34', 'https://upload.wikimedia.org/wikipedia/commons/d/db/Hilton_Hotel_-_Kuching%2C_Malaysia.jpg', 'image', 0, 'Exterior of the Hilton Kuching hotel tower'),
  ('7593ca5c-9847-75f0-cf57-db0ffefb10b3', '1dbca93a-6bfe-af43-110b-591e4a795b34', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Hilton_Kuching.jpg/1280px-Hilton_Kuching.jpg', 'image', 1, 'Hilton Kuching building seen from street level'),
  ('7593ca5c-9847-75f0-cf57-db0ffefb10b3', '1dbca93a-6bfe-af43-110b-591e4a795b34', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Twin_guest_room_Hilton_Kota_Kinabalu_20251207_182012.jpg/1280px-Twin_guest_room_Hilton_Kota_Kinabalu_20251207_182012.jpg', 'image', 2, 'Twin guest room in a Malaysian Hilton hotel'),
  ('7593ca5c-9847-75f0-cf57-db0ffefb10b3', '1dbca93a-6bfe-af43-110b-591e4a795b34', 'https://images.unsplash.com/photo-1762774365051-add54197be99?w=1280&q=80', 'image', 3, 'Boats on the Sarawak River in Kuching with a landmark building behind');

-- ===== Histana Hotel =====
-- source (about): https://www.expedia.co.uk/Klang-Hotels-Klang-Histana-Hotel.h8128121.Hotel-Information
-- source (amenities): https://www.expedia.co.uk/Klang-Hotels-Klang-Histana-Hotel.h8128121.Hotel-Information
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: No official website found; facts come from booking listings (room types Standard, Deluxe, Suite, Family). Superior Room is not a listed category and is invented. Room sizes are estimates. Listings conflict on parking (free vs none) and front-desk hours, so free_parking and front_desk_24h were left out. One property listing says part of the building is now used for elderly care and confinement rooms.
UPDATE public.outlets
SET hotel_about = 'A three-star business hotel in Klang, Selangor, a short drive from AEON Bukit Raja and the town''s food and heritage spots. It pairs simple city-view rooms with V Garden Chinese restaurant, a Nyonya-style coffee shop, the Stopover Lounge lobby bar, meeting rooms and a business centre.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed. Rooms are non-smoking; smoking is only permitted in designated outdoor areas. One extra bed can be added to Deluxe rooms and suites for a nightly fee, and a refundable cash or card deposit is required at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'a0b05bcd-e3e6-0e9c-69c5-f499c02f78f1';

-- Deluxe Room -- source: https://www.expedia.co.uk/Klang-Hotels-Klang-Histana-Hotel.h8128121.Hotel-Information
UPDATE public.products
SET description = 'A roomier city-view room with a seating corner and space for a third guest.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 3, "sizeSqm": 28, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV with satellite channels", "Work desk", "Coffee and tea making", "Private bathroom with shower", "Hairdryer on request", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '8ee1c5a4-5723-d155-b51e-31b81ddf097d';

-- Family Room -- source: https://www.expedia.co.uk/Klang-Hotels-Klang-Histana-Hotel.h8128121.Hotel-Information
UPDATE public.products
SET description = 'A family room with two larger beds, sleeping up to four, with connecting options on request.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 36, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV with satellite channels", "Coffee and tea making", "Private bathroom with shower", "Hairdryer on request", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'a52aa33a-b104-4606-aa5f-6d57dab21c72';

-- Standard Room -- source: https://www.expedia.co.uk/Klang-Hotels-Klang-Histana-Hotel.h8128121.Hotel-Information
UPDATE public.products
SET description = 'A straightforward air-conditioned room for short business or transit stays.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 20, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV with satellite channels", "Coffee and tea making", "Private bathroom with shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '8968b06a-ab00-741b-59a5-730d33e65e53';

-- Suite -- source: https://www.expedia.co.uk/Klang-Hotels-Klang-Histana-Hotel.h8128121.Hotel-Information
UPDATE public.products
SET description = 'The hotel''s largest room type, with a separate lounge area for working or relaxing.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 45, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Separate lounge area", "Air conditioning", "TV with satellite channels", "Work desk", "Coffee and tea making", "Minibar (chargeable)", "Hairdryer", "Free Wi-Fi"]}'::jsonb
WHERE id = 'e3a88a4a-60fc-498a-a307-8c2bd9150cee';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A tidy city-view room with a work desk, a step up from Standard.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV with satellite channels", "Work desk", "Coffee and tea making", "Private bathroom with shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '9e287d93-3333-4d9e-a75b-e2dbec43f5d0';

-- photo 1 (this hotel, Public domain): https://commons.wikimedia.org/wiki/File:Histana_Hotel.jpg
-- photo 2 (this hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Histana.jpg
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/modern-lobby-with-marble-reception-desk-and-plants-pt0nGH-NvoA
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/P6B7y6Gnyzw
DELETE FROM public.media_assets WHERE outlet_id = 'a0b05bcd-e3e6-0e9c-69c5-f499c02f78f1' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('9b512100-9b9a-a489-e256-4a434f489d5c', 'a0b05bcd-e3e6-0e9c-69c5-f499c02f78f1', 'https://upload.wikimedia.org/wikipedia/commons/1/14/Histana_Hotel.jpg', 'image', -1, 'Yellow facade of Hotel Histana with its signboard and palm trees'),
  ('9b512100-9b9a-a489-e256-4a434f489d5c', 'a0b05bcd-e3e6-0e9c-69c5-f499c02f78f1', 'https://upload.wikimedia.org/wikipedia/commons/1/14/Histana_Hotel.jpg', 'image', 0, 'Yellow facade of Hotel Histana with its signboard and palm trees'),
  ('9b512100-9b9a-a489-e256-4a434f489d5c', 'a0b05bcd-e3e6-0e9c-69c5-f499c02f78f1', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Histana.jpg/1280px-Histana.jpg', 'image', 1, 'Klang street view with the hotel building among nearby towers'),
  ('9b512100-9b9a-a489-e256-4a434f489d5c', 'a0b05bcd-e3e6-0e9c-69c5-f499c02f78f1', 'https://images.unsplash.com/photo-1758448500688-3ababa93fd67?w=1280&q=80', 'image', 2, 'Hotel lobby with a marble reception desk, wood panelling and plants'),
  ('9b512100-9b9a-a489-e256-4a434f489d5c', 'a0b05bcd-e3e6-0e9c-69c5-f499c02f78f1', 'https://images.unsplash.com/photo-1608198399988-341f712c3711?w=1280&q=80', 'image', 3, 'Twin-bed hotel room with teal bedding, a desk and a TV');

-- ===== Hotel CIQ =====
-- source (about): https://www.kayak.com/Johor-Bahru-Hotels-Hotel-CIQ.616744.ksp
-- source (amenities): https://www.kayak.com/Johor-Bahru-Hotels-Hotel-CIQ.616744.ksp
-- source (check-in/out): https://www.kayak.com/Johor-Bahru-Hotels-Hotel-CIQ.616744.ksp
-- source (policies): https://www.kayak.com/Johor-Bahru-Hotels-Hotel-CIQ.616744.ksp
-- note: Official site ciqhotel.com did not render; facts from Kayak/Frommer's listings. Listings disagree on address (Jalan Lumba Kuda vs Jalan Trus) and room count (25 vs 49). Room details invented. Cover photo is the actual hotel (Commons).
UPDATE public.outlets
SET hotel_about = 'A budget city hotel in central Johor Bahru with a bright, colourful facade, within walking distance of JB Sentral, City Square mall and the CIQ checkpoint for Singapore. Rooms are compact and air-conditioned, and a 24-hour front desk, lift and free Wi-Fi make it a convenient base for short shopping trips or early border crossings.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'front_desk_24h', 'free_parking']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'A cash deposit of MYR 100 per stay is collected at check-in and returned at check-out. Smoking and pets are not allowed in rooms. Extra beds are not offered in the budget rooms, so families should book the Family Room.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '3b7a258e-7a45-df6b-6e5f-e2a2b8d457c3';

-- CIQ Budget Single -- source: invented for demo
UPDATE public.products
SET description = 'A no-frills single room for solo travellers crossing to or from Singapore.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 single bed", "maxGuests": 1, "sizeSqm": 10, "view": "No window", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Towels and basic toiletries"]}'::jsonb
WHERE id = '81e79799-3dea-fbc8-04e2-1d700225a1b9';

-- CIQ Budget Twin -- source: invented for demo
UPDATE public.products
SET description = 'A compact budget room with two single beds for friends sharing a short stay.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 2, "sizeSqm": 13, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Towels and basic toiletries"]}'::jsonb
WHERE id = 'c51c024b-2ecc-44a8-32b0-11244af94a0c';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A roomier room with a queen or twin beds, a work desk and views over the city centre.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 20, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "LCD TV", "Free Wi-Fi", "Kettle", "Work desk", "Mini fridge"]}'::jsonb
WHERE id = '992e8f0e-ba80-495c-a174-ce7d9e5df3eb';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with a queen bed and two singles, sleeping up to four.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 26, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "LCD TV", "Free Wi-Fi", "Kettle", "Mini fridge", "Wardrobe"]}'::jsonb
WHERE id = 'ca6c5633-53e8-427e-a0e8-70a051e8eb52';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A comfortable room with a queen bed and a window, a step up from the budget rooms.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 16, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "LCD TV", "Free Wi-Fi", "Kettle", "Towels and basic toiletries"]}'::jsonb
WHERE id = '818ad831-7d5d-43d6-adf4-81e49cbae32e';

-- photo 1 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:CIQ_Hotel.jpg
-- photo 2 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Johor_Bahru_city_in_2015.jpg
-- photo 3 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Bed_in_hotel_room_3.jpg
-- photo 4 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Bed_in_hotel_room_6.jpg
DELETE FROM public.media_assets WHERE outlet_id = '3b7a258e-7a45-df6b-6e5f-e2a2b8d457c3' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('b76a2a28-f6eb-c929-6e1b-b5353f332883', '3b7a258e-7a45-df6b-6e5f-e2a2b8d457c3', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/CIQ_Hotel.jpg/1280px-CIQ_Hotel.jpg', 'image', -1, 'Colourful striped facade of Hotel CIQ in Johor Bahru city centre'),
  ('b76a2a28-f6eb-c929-6e1b-b5353f332883', '3b7a258e-7a45-df6b-6e5f-e2a2b8d457c3', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/CIQ_Hotel.jpg/1280px-CIQ_Hotel.jpg', 'image', 0, 'Colourful striped facade of Hotel CIQ in Johor Bahru city centre'),
  ('b76a2a28-f6eb-c929-6e1b-b5353f332883', '3b7a258e-7a45-df6b-6e5f-e2a2b8d457c3', 'https://upload.wikimedia.org/wikipedia/commons/e/e9/Johor_Bahru_city_in_2015.jpg', 'image', 1, 'Aerial view of Johor Bahru city centre near the CIQ complex'),
  ('b76a2a28-f6eb-c929-6e1b-b5353f332883', '3b7a258e-7a45-df6b-6e5f-e2a2b8d457c3', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Bed_in_hotel_room_3.jpg/1280px-Bed_in_hotel_room_3.jpg', 'image', 2, 'Hotel room with two queen beds'),
  ('b76a2a28-f6eb-c929-6e1b-b5353f332883', '3b7a258e-7a45-df6b-6e5f-e2a2b8d457c3', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Bed_in_hotel_room_6.jpg/1280px-Bed_in_hotel_room_6.jpg', 'image', 3, 'Hotel room with a queen bed and white linen');

-- ===== Hotel Classic =====
-- source (about): https://www.expedia.ca/Muar-Hotels-Classic-Hotel-Muar.h34881893.Hotel-Information
-- source (amenities): https://www.expedia.ca/Muar-Hotels-Classic-Hotel-Muar.h34881893.Hotel-Information
-- source (check-in/out): invented for demo
-- source (policies): https://www.expedia.ca/Muar-Hotels-Classic-Hotel-Muar.h34881893.Hotel-Information
-- note: Listed on booking sites as Classic Hotel Muar (No 69, Jalan Ali). No official website found. Check-in/out times not confirmed, defaults used. Room mapping: Hotel Classic Family Room = Family Suite; Standard Room invented (smallest official type is Superior). No Commons photos of the hotel; cover shows a different Muar hotel (PPT Muar Hotel) as a stand-in.
UPDATE public.outlets
SET hotel_about = 'A three-star city hotel on Jalan Ali in Muar''s town centre, linked to a shopping centre and close to Wetex Parade and the riverside. It has a restaurant, a banquet hall and meeting rooms popular for weddings and events, plus free parking and Wi-Fi throughout.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'free_parking', 'front_desk_24h', 'air_conditioning']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'The hotel is entirely non-smoking and pets are not allowed. Breakfast is available for about MYR20 per person. Children are welcome, and connecting rooms can be requested for families, subject to availability.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '9a9324dc-58e6-2778-c8cb-b98b45569f66';

-- Deluxe Room -- source: https://www.expedia.ca/Muar-Hotels-Classic-Hotel-Muar.h34881893.Hotel-Information
UPDATE public.products
SET description = 'A deluxe room with a work desk and a deep soaking bathtub, good for business stays.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 2, "sizeSqm": 28, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV", "Blackout curtains", "In-room safe", "Kettle with tea and coffee", "Free Wi-Fi", "Daily housekeeping", "Bathtub"]}'::jsonb
WHERE id = 'e41536bd-3c1f-4c37-a385-ef1cb9689cff';

-- Family Room -- source: https://www.expedia.ca/Muar-Hotels-Classic-Hotel-Muar.h34881893.Hotel-Information
UPDATE public.products
SET description = 'A spacious family room that sleeps four, with two beds and room to unpack.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 39, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV", "Blackout curtains", "In-room safe", "Kettle with tea and coffee", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '1da80b49-a079-48c9-a859-a7e3f9aa5c33';

-- Hotel Classic Family Room -- source: https://www.expedia.ca/Muar-Hotels-Classic-Hotel-Muar.h34881893.Hotel-Information
UPDATE public.products
SET description = 'The family suite, with a separate bedroom and living area for longer family stays.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 5, "sizeSqm": 45, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV", "Blackout curtains", "In-room safe", "Kettle with tea and coffee", "Free Wi-Fi", "Daily housekeeping", "Separate living area"]}'::jsonb
WHERE id = '9e705ac8-fe31-d669-4607-ef30a5a5c9f8';

-- Hotel Classic Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A neat standard room with the essentials for a short stay in Muar town.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 20, "view": "Inner or town view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV", "Blackout curtains", "In-room safe", "Kettle with tea and coffee", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '2ad2ddec-fdb0-d214-3d8d-10a60007713f';

-- Superior Room -- source: https://www.expedia.ca/Muar-Hotels-Classic-Hotel-Muar.h34881893.Hotel-Information
UPDATE public.products
SET description = 'A comfortable superior room with modern furnishings and a private bathroom.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "LCD TV", "Blackout curtains", "In-room safe", "Kettle with tea and coffee", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '685feaf8-b4bc-4447-ac74-273b0744ac20';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:PPT_Muar_Hotel.jpg
-- photo 2 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Gunung_Ledang_from_Muar_River.jpg
-- photo 3 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Family_Room.jpg
-- photo 4 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Bed_in_hotel_room_2.jpg
DELETE FROM public.media_assets WHERE outlet_id = '9a9324dc-58e6-2778-c8cb-b98b45569f66' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('084ed2cc-b255-c8db-a2fb-1e2de05453e7', '9a9324dc-58e6-2778-c8cb-b98b45569f66', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/PPT_Muar_Hotel.jpg/1280px-PPT_Muar_Hotel.jpg', 'image', -1, 'Orange-painted mid-range hotel building in Muar town'),
  ('084ed2cc-b255-c8db-a2fb-1e2de05453e7', '9a9324dc-58e6-2778-c8cb-b98b45569f66', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/PPT_Muar_Hotel.jpg/1280px-PPT_Muar_Hotel.jpg', 'image', 0, 'Orange-painted mid-range hotel building in Muar town'),
  ('084ed2cc-b255-c8db-a2fb-1e2de05453e7', '9a9324dc-58e6-2778-c8cb-b98b45569f66', 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Gunung_Ledang_from_Muar_River.jpg/1280px-Gunung_Ledang_from_Muar_River.jpg', 'image', 1, 'View of the Muar River with Gunung Ledang in the distance'),
  ('084ed2cc-b255-c8db-a2fb-1e2de05453e7', '9a9324dc-58e6-2778-c8cb-b98b45569f66', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Family_Room.jpg/1280px-Family_Room.jpg', 'image', 2, 'Hotel room with a double bed and a sofa seating area'),
  ('084ed2cc-b255-c8db-a2fb-1e2de05453e7', '9a9324dc-58e6-2778-c8cb-b98b45569f66', 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Bed_in_hotel_room_2.jpg/1280px-Bed_in_hotel_room_2.jpg', 'image', 3, 'Hotel room with a large double bed and reading lamps');

-- ===== Hotel Langkasuka =====
-- source (about): https://ie.hotels.com/ho394376/hotel-langkasuka-langkawi-malaysia
-- source (amenities): https://ie.hotels.com/ho394376/hotel-langkasuka-langkawi-malaysia
-- source (check-in/out): https://ie.hotels.com/ho394376/hotel-langkasuka-langkawi-malaysia
-- source (policies): invented for demo
-- note: No official website content found (hotellangkasuka.com is an empty page); facts come from Hotels.com/Expedia listings. Room types and sizes are invented to fit a 3-star town hotel.
UPDATE public.outlets
SET hotel_about = 'A three-star hotel with 168 rooms in the heart of Kuah town, Langkawi, linked to a shopping area and a two-minute walk from Langkawi Parade mall. The jetty is only a few minutes away by car, and guests have an outdoor pool, a café serving breakfast, free Wi-Fi and free parking.',
    amenity_codes = ARRAY['wifi', 'free_parking', 'swimming_pool', 'restaurant', 'breakfast', 'air_conditioning', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and smoking is only permitted in outdoor areas. Children under 6 stay free using existing beds; an extra bed costs a nightly fee and fits in Deluxe rooms and above. A small cash deposit is collected at check-in and returned on departure.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '601ac353-eb63-07c3-feab-c14b62c2004d';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A comfortable room on a higher floor with a seating area and views over Kuah town.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 3, "sizeSqm": 28, "view": "Town or pool view", "smoking": "non_smoking", "roomAmenities": ["Bathtub with shower", "Seating area", "Flat-screen TV", "Kettle with tea and coffee", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '94ca7c2c-31c4-7f89-3b97-0b5b12d6c70c';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with a queen bed and two singles, handy for families shopping duty-free in Kuah.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 34, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Flat-screen TV", "Kettle with tea and coffee", "Mini fridge", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '1ec2dd62-7dec-4ba6-a99c-ac4d1712fccc';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A simple, air-conditioned room for two with everything needed for a short Kuah stopover.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 20, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Flat-screen TV", "Kettle with tea and coffee", "Air conditioning", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '8d3226aa-e848-b538-f07a-243fe38bc28e';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'A suite with a separate sitting room and bathtub, the most spacious option in the hotel.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 45, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Separate sitting room", "Bathtub with shower", "Two flat-screen TVs", "Kettle with tea and coffee", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '231cc869-e141-49c2-a1f9-000f26b4206b';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A slightly larger room with a small work desk and a choice of queen or twin beds.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Work desk", "Flat-screen TV", "Kettle with tea and coffee", "Mini fridge", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'c1d2222b-6c2c-4848-afc8-b3a07285d42b';

-- photo 1 (similar hotel, Unsplash License): https://unsplash.com/photos/a-pool-in-front-of-a-building-GvcIU5xs7mQ
-- photo 2 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Pulau_Langkawi_-_Kuah_town.JPG
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/hotel-room-with-two-beds-Ph39hqrPTcI
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/a-well-lit-hotel-room-with-seating-and-a-desk-xQbmc2FnK3Y
DELETE FROM public.media_assets WHERE outlet_id = '601ac353-eb63-07c3-feab-c14b62c2004d' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('9ac7d664-6101-35a0-427c-ee061b389b07', '601ac353-eb63-07c3-feab-c14b62c2004d', 'https://images.unsplash.com/photo-1661016630713-67e36bfc2285?w=1280&q=80', 'image', -1, 'Outdoor hotel pool with sun loungers in front of a low-rise building'),
  ('9ac7d664-6101-35a0-427c-ee061b389b07', '601ac353-eb63-07c3-feab-c14b62c2004d', 'https://images.unsplash.com/photo-1661016630713-67e36bfc2285?w=1280&q=80', 'image', 0, 'Outdoor hotel pool with sun loungers in front of a low-rise building'),
  ('9ac7d664-6101-35a0-427c-ee061b389b07', '601ac353-eb63-07c3-feab-c14b62c2004d', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Pulau_Langkawi_-_Kuah_town.JPG/1280px-Pulau_Langkawi_-_Kuah_town.JPG', 'image', 1, 'View over Kuah town, the commercial centre of Langkawi'),
  ('9ac7d664-6101-35a0-427c-ee061b389b07', '601ac353-eb63-07c3-feab-c14b62c2004d', 'https://images.unsplash.com/photo-1790774868320-64fd572a7aa7?w=1280&q=80', 'image', 2, 'Hotel room with two beds, wooden furniture and a wall-mounted TV'),
  ('9ac7d664-6101-35a0-427c-ee061b389b07', '601ac353-eb63-07c3-feab-c14b62c2004d', 'https://images.unsplash.com/photo-1776763018821-8feeaeeee0a5?w=1280&q=80', 'image', 3, 'Well-lit hotel room with seating and a desk');

-- ===== Hotel Puri =====
-- source (about): https://www.trip.com/hotels/malacca-hotel-detail-713223/hotel-puri-melaka/
-- source (amenities): https://www.trip.com/hotels/malacca-hotel-detail-713223/hotel-puri-melaka/
-- source (check-in/out): https://zh.hotels.com/en/ho500525/puri-melaka-malacca-city-malaysia
-- source (policies): https://zh.hotels.com/en/ho500525/puri-melaka-malacca-city-malaysia
-- note: No reachable official website; facts come from Trip.com and Hotels.com listings. Room mapping: Courtyard Suite = Puri Suite (50 sqm); Family Room = Family Suite (45 sqm); Superior Room = Superior Twin (21 sqm). Deluxe Room and Peranakan Heritage Room are invented. Listings disagree on front-desk hours. No openly licensed photos of the hotel exist, so the photos show similar Peranakan buildings and interiors.
UPDATE public.outlets
SET hotel_about = 'A heritage hotel set in a restored Peranakan mansion on Jalan Tun Tan Cheng Lock (Heeren Street), in the heart of Melaka''s UNESCO-listed old town. Guests pass through an ornate entrance hall to a quiet inner courtyard garden, with Jonker Walk, the river and the Dutch Square all within walking distance.',
    amenity_codes = ARRAY['wifi', 'breakfast', 'restaurant', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Check-in runs from 3pm to 10pm and the front desk is not staffed overnight, so late arrivals must be arranged 24 hours ahead. A card or cash deposit and photo ID are required at check-in. Pets are not allowed and the whole building is non-smoking to protect the heritage interiors.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '809e61ce-d9d8-7fdd-6f3f-14a745fe65f6';

-- Courtyard Suite -- source: https://www.trip.com/hotels/malacca-hotel-detail-713223/hotel-puri-melaka/
UPDATE public.products
SET description = 'The hotel''s grandest room, with period furnishings and windows over the inner courtyard garden.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 50, "view": "Courtyard garden view", "smoking": "non_smoking", "roomAmenities": ["Separate sitting area", "Peranakan-style furnishings", "Air conditioning", "Coffee and tea making", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '554a85a1-b933-7aa0-773c-1e58c0f2d4b2';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A comfortable room in the newer wing with a little more space and a writing desk.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV", "Writing desk", "Coffee and tea making", "Shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '5cfa3107-25b5-4a5c-a306-d3058de06ae9';

-- Family Room -- source: https://www.trip.com/hotels/malacca-hotel-detail-713223/hotel-puri-melaka/
UPDATE public.products
SET description = 'A family suite with a double bed and two singles, a short walk from Jonker Walk.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed and 2 single beds", "maxGuests": 4, "sizeSqm": 45, "view": "Inner courtyard view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV", "Coffee and tea making", "Shower", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '9bceda2c-b2c8-4658-a59a-9fc7acc8cb34';

-- Peranakan Heritage Room -- source: invented for demo
UPDATE public.products
SET description = 'A room in the original mansion with antique Straits Chinese furniture and timber details.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 26, "view": "Heritage street or courtyard view", "smoking": "non_smoking", "roomAmenities": ["Antique Peranakan furniture", "Air conditioning", "Coffee and tea making", "Shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '81a482a6-64be-dd65-7c8d-8a2f1a9751ce';

-- Superior Room -- source: https://www.trip.com/hotels/malacca-hotel-detail-713223/hotel-puri-melaka/
UPDATE public.products
SET description = 'A neat twin room with simple heritage touches, good for friends exploring the old town.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 2, "sizeSqm": 21, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV", "Coffee and tea making", "Shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '64f26879-5a5e-4c0e-a313-cbd5054fe635';

-- photo 1 (similar hotel, Unsplash License): https://unsplash.com/photos/a-blue-and-pink-building-with-a-white-gate-OD8UD-du5Ow
-- photo 2 (similar hotel, Unsplash License): https://unsplash.com/photos/brown-wooden-table-with-chairs--q84ItSFZDM
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/a-room-that-has-a-skylight-above-it-XcV4dWotNAw
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/T5pL6ciEn-I
DELETE FROM public.media_assets WHERE outlet_id = '809e61ce-d9d8-7fdd-6f3f-14a745fe65f6' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('4f674162-ec4a-ca0e-86fd-8c39dfebb79a', '809e61ce-d9d8-7fdd-6f3f-14a745fe65f6', 'https://images.unsplash.com/photo-1727893524535-99878c61125b?w=1280&q=80', 'image', -1, 'Pastel Peranakan shophouse facade with carved shutters and a white gate'),
  ('4f674162-ec4a-ca0e-86fd-8c39dfebb79a', '809e61ce-d9d8-7fdd-6f3f-14a745fe65f6', 'https://images.unsplash.com/photo-1727893524535-99878c61125b?w=1280&q=80', 'image', 0, 'Pastel Peranakan shophouse facade with carved shutters and a white gate'),
  ('4f674162-ec4a-ca0e-86fd-8c39dfebb79a', '809e61ce-d9d8-7fdd-6f3f-14a745fe65f6', 'https://images.unsplash.com/photo-1617030905020-f45d2e450f9c?w=1280&q=80', 'image', 1, 'Peranakan reception hall with carved wooden screens and a round marble table'),
  ('4f674162-ec4a-ca0e-86fd-8c39dfebb79a', '809e61ce-d9d8-7fdd-6f3f-14a745fe65f6', 'https://images.unsplash.com/photo-1709198165282-1dab551df890?w=1280&q=80', 'image', 2, 'Open air well with wooden louvred windows in a traditional townhouse'),
  ('4f674162-ec4a-ca0e-86fd-8c39dfebb79a', '809e61ce-d9d8-7fdd-6f3f-14a745fe65f6', 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1280&q=80', 'image', 3, 'Warm wood-panelled bedroom opening onto a small garden');

-- ===== Hotel Sri Garden =====
-- source (about): https://ae.trip.com/hotels/kechor-hotel-detail-3068221/hotel-sri-garden-sdn-bhd
-- source (amenities): https://ae.trip.com/hotels/kechor-hotel-detail-3068221/hotel-sri-garden-sdn-bhd
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: No official website; facts from Trip.com listings (address given as Kechor/Kangar, 01000). Ratings are low and sparse; all room details invented. Photos show Kangar town and generic rooms.
UPDATE public.outlets
SET hotel_about = 'A small budget hotel on Persiaran Jubli Emas in the middle of Kangar, the compact state capital of Perlis, close to shops, eateries and the bus station. It offers plain air-conditioned rooms, breakfast, private parking and a 24-hour front desk, and is a handy overnight stop before heading to Padang Besar or the Kuala Perlis ferry to Langkawi.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'breakfast', 'free_parking', 'front_desk_24h']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Smoking is not allowed in rooms and pets are not accepted. Children under 6 stay free using existing beds, and an extra mattress can be added to most rooms for a small charge. Payment is due on arrival.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '7c7f1b01-8130-891d-acda-0d25828c66d7';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A larger room with a queen bed, tea and coffee facilities and a view of the town.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 22, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Coffee and tea making", "Blackout curtains", "Daily housekeeping"]}'::jsonb
WHERE id = '69ab06b5-35fa-4066-a5ce-68fd99da9f34';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with two queen beds, comfortably sleeping four.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 28, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Coffee and tea making", "Wardrobe", "Daily housekeeping"]}'::jsonb
WHERE id = '3c46c6c5-c115-5fcf-1d66-954d350c0347';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A simple room for two with a double bed, air-conditioning and a private bathroom.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed", "maxGuests": 2, "sizeSqm": 14, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '7271006f-ed95-f2af-ff73-bed54ba0345a';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'The hotel''s largest room, with a king bed and a separate sitting area.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 34, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Coffee and tea making", "Sofa seating", "Mini fridge", "Daily housekeeping"]}'::jsonb
WHERE id = '1ca9d718-54f2-4b26-a578-dfa1385d9544';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A tidy room with a queen or twin beds and blackout curtains for a good night''s rest.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 18, "view": "Street view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Blackout curtains", "Daily housekeeping"]}'::jsonb
WHERE id = '9cc0fb9a-232b-42e9-a63e-7a3b5c59c0bb';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Kangar_(2019).jpg
-- photo 2 (similar hotel, CC BY-SA 2.0): https://commons.wikimedia.org/wiki/File:Kangar_Titi_Gantung_(30777173294).jpg
-- photo 3 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Bed_in_hotel_room_5.jpg
-- photo 4 (similar hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Standard_Twin.jpg
DELETE FROM public.media_assets WHERE outlet_id = '7c7f1b01-8130-891d-acda-0d25828c66d7' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('7c683ed4-7091-b0df-caa8-21dce1bf3d88', '7c7f1b01-8130-891d-acda-0d25828c66d7', 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Kangar_%282019%29.jpg/1280px-Kangar_%282019%29.jpg', 'image', -1, 'Main road through Kangar town centre with a welcome arch'),
  ('7c683ed4-7091-b0df-caa8-21dce1bf3d88', '7c7f1b01-8130-891d-acda-0d25828c66d7', 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Kangar_%282019%29.jpg/1280px-Kangar_%282019%29.jpg', 'image', 0, 'Main road through Kangar town centre with a welcome arch'),
  ('7c683ed4-7091-b0df-caa8-21dce1bf3d88', '7c7f1b01-8130-891d-acda-0d25828c66d7', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Kangar_Titi_Gantung_%2830777173294%29.jpg/1280px-Kangar_Titi_Gantung_%2830777173294%29.jpg', 'image', 1, 'Suspension bridge over the Perlis River in Kangar'),
  ('7c683ed4-7091-b0df-caa8-21dce1bf3d88', '7c7f1b01-8130-891d-acda-0d25828c66d7', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Bed_in_hotel_room_5.jpg/1280px-Bed_in_hotel_room_5.jpg', 'image', 2, 'Hotel room with a queen bed, bedside lamps and armchair'),
  ('7c683ed4-7091-b0df-caa8-21dce1bf3d88', '7c7f1b01-8130-891d-acda-0d25828c66d7', 'https://upload.wikimedia.org/wikipedia/commons/6/63/Standard_Twin.jpg', 'image', 3, 'Twin room with two beds and a work desk');

-- ===== Hotel Sri Tanjung =====
-- source (about): invented for demo
-- source (amenities): invented for demo
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: No hotel by this name could be found online for Kuala Terengganu (closest match is Hotel Tanjong Vista); all details invented for demo. Cover shows a different Kuala Terengganu hotel (Grand Puteri) as a stand-in.
UPDATE public.outlets
SET hotel_about = 'A friendly mid-range hotel in Kuala Terengganu, close to the riverfront, Pasar Payang and the colourful Kampung Cina street. It offers clean air-conditioned rooms, a ground-floor cafe serving Terengganu breakfasts such as nasi dagang, and easy access to the jetty for Redang and Perhentian trips.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'free_parking', 'front_desk_24h', 'air_conditioning', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'All rooms are non-smoking and pets are not allowed. One extra bed can be added in Deluxe rooms and suites for a nightly fee. A refundable deposit of MYR50 is collected at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '7dd2c97e-b0c4-c8ac-be8c-6a6aa936b700';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A deluxe room with extra space, a work desk and city views towards the river.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 3, "sizeSqm": 26, "view": "City or river view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Kettle with tea and coffee", "Hot shower", "Free Wi-Fi", "Daily housekeeping", "Work desk"]}'::jsonb
WHERE id = '6bb3bcb1-f362-48e2-af06-53b9f68300d7';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with two queen beds, sized for parents travelling with children.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 32, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Kettle with tea and coffee", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'd7a5e19a-8d75-a7ec-688a-57fa02c8e954';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A simple standard room for short stays, with a comfortable bed and en-suite shower.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed", "maxGuests": 2, "sizeSqm": 16, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Kettle with tea and coffee", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'edf3f5a7-2486-0a95-e6c2-be47b5a8637f';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'The hotel''s top-floor suite with a separate sitting area and wide river views.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 42, "view": "River view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Kettle with tea and coffee", "Hot shower", "Free Wi-Fi", "Daily housekeeping", "Sitting area", "Minibar"]}'::jsonb
WHERE id = '51e22523-bcf5-4312-ad12-244ad5dc8168';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A bright superior room with modern furnishings, good for couples or solo travellers.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 20, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Kettle with tea and coffee", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'a9dbe303-cd18-4e81-a440-5eab5ae5b793';

-- photo 1 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Grand_Puteri_Hotel_-_panoramio.jpg
-- photo 2 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Kuala_Terengganu_Waterfront,_Kuala_Terengganu_20240227_124551.jpg
-- photo 3 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Kampung_cina_kuala_terengganu.jpg
-- photo 4 (similar hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Aston_Kuta_Family_Room_(11267223136).jpg
DELETE FROM public.media_assets WHERE outlet_id = '7dd2c97e-b0c4-c8ac-be8c-6a6aa936b700' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('8a552ebe-437e-3096-b718-e98565ff94bf', '7dd2c97e-b0c4-c8ac-be8c-6a6aa936b700', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Grand_Puteri_Hotel_-_panoramio.jpg/1280px-Grand_Puteri_Hotel_-_panoramio.jpg', 'image', -1, 'Mid-rise city hotel in Kuala Terengganu with a domed rooftop'),
  ('8a552ebe-437e-3096-b718-e98565ff94bf', '7dd2c97e-b0c4-c8ac-be8c-6a6aa936b700', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Grand_Puteri_Hotel_-_panoramio.jpg/1280px-Grand_Puteri_Hotel_-_panoramio.jpg', 'image', 0, 'Mid-rise city hotel in Kuala Terengganu with a domed rooftop'),
  ('8a552ebe-437e-3096-b718-e98565ff94bf', '7dd2c97e-b0c4-c8ac-be8c-6a6aa936b700', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Kuala_Terengganu_Waterfront%2C_Kuala_Terengganu_20240227_124551.jpg/1280px-Kuala_Terengganu_Waterfront%2C_Kuala_Terengganu_20240227_124551.jpg', 'image', 1, 'Globe sculpture at the Kuala Terengganu waterfront'),
  ('8a552ebe-437e-3096-b718-e98565ff94bf', '7dd2c97e-b0c4-c8ac-be8c-6a6aa936b700', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Kampung_cina_kuala_terengganu.jpg/1280px-Kampung_cina_kuala_terengganu.jpg', 'image', 2, 'Street of shophouses in Kampung Cina, Kuala Terengganu'),
  ('8a552ebe-437e-3096-b718-e98565ff94bf', '7dd2c97e-b0c4-c8ac-be8c-6a6aa936b700', 'https://upload.wikimedia.org/wikipedia/commons/4/4b/Aston_Kuta_Family_Room_%2811267223136%29.jpg', 'image', 3, 'Bright hotel room with two beds and full-length curtains');

-- ===== Hotel Sri Terengganu =====
-- source (about): invented for demo
-- source (amenities): invented for demo
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: No hotel named 'Hotel Sri Terengganu' could be found online; the closest real property is Hotel Seri Malaysia Kuala Terengganu on Jalan Hiliran. All text and room data are invented for demo as a generic 3-star city hotel.
UPDATE public.outlets
SET hotel_about = 'A friendly mid-range hotel in central Kuala Terengganu, within walking distance of Kampung Cina, the Pasar Payang market and the riverside. It offers air-conditioned rooms, a coffee house serving local and Western dishes, free Wi-Fi and on-site parking, making it a practical base for exploring the city and nearby beaches.',
    amenity_codes = ARRAY['wifi', 'free_parking', 'restaurant', 'breakfast', 'air_conditioning', 'front_desk_24h', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all rooms are non-smoking. Children under 6 stay free when using existing beds, and an extra bed can be added for a nightly fee. A refundable cash deposit is required at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '37fb885f-7c7d-7f30-bb23-76900ff15a18';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A comfortable room on an upper floor with a king bed and a small seating area.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 26, "view": "City or river view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Seating area", "Flat-screen TV", "Kettle with tea and coffee", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '7cf5a7f8-4c7a-35ab-530c-e7e733f81158';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with a queen bed and two singles for parents travelling with children.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 32, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Flat-screen TV", "Kettle with tea and coffee", "Mini fridge", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'f8886a0d-ac9b-4a0d-af7b-eaaf24f5e0f1';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A neat, air-conditioned room for two, good value for a night in the city centre.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 18, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Flat-screen TV", "Kettle with tea and coffee", "Air conditioning", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'ba53c414-0d07-43fe-94af-28f331381184';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'A suite with a separate living room, the largest and quietest option in the hotel.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 42, "view": "City or river view", "smoking": "non_smoking", "roomAmenities": ["Separate living room", "Bathtub with shower", "Two flat-screen TVs", "Kettle with tea and coffee", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '80d1e84c-b5ad-42f1-a16b-5f4d05f42363';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A slightly roomier room with a work desk and a small fridge.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 22, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Work desk", "Flat-screen TV", "Kettle with tea and coffee", "Mini fridge", "Free Wi-Fi"]}'::jsonb
WHERE id = '2dcc56d7-ca71-4c16-a3ca-038b4bc576ac';

-- photo 1 (similar hotel, Unsplash License): https://unsplash.com/photos/white-concrete-building-near-green-grass-field-during-daytime-5Re--kAsKco
-- photo 2 (similar hotel, CC BY 4.0): https://commons.wikimedia.org/wiki/File:Beach_at_Kuala_Terengganu,_Malaysia.jpg
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/hotel-room-with-two-twin-beds-6H3J8H7LJlE
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/a-bed-with-white-sheets-and-pillows-in-a-room-qifUgNsrWmU
DELETE FROM public.media_assets WHERE outlet_id = '37fb885f-7c7d-7f30-bb23-76900ff15a18' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('7249945b-7899-b290-1579-870092c246ce', '37fb885f-7c7d-7f30-bb23-76900ff15a18', 'https://images.unsplash.com/photo-1607320895054-c5c543e9a069?w=1280&q=80', 'image', -1, 'Low-rise white hotel buildings among palm trees and lawn'),
  ('7249945b-7899-b290-1579-870092c246ce', '37fb885f-7c7d-7f30-bb23-76900ff15a18', 'https://images.unsplash.com/photo-1607320895054-c5c543e9a069?w=1280&q=80', 'image', 0, 'Low-rise white hotel buildings among palm trees and lawn'),
  ('7249945b-7899-b290-1579-870092c246ce', '37fb885f-7c7d-7f30-bb23-76900ff15a18', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Beach_at_Kuala_Terengganu%2C_Malaysia.jpg/1280px-Beach_at_Kuala_Terengganu%2C_Malaysia.jpg', 'image', 1, 'Sandy beach at Kuala Terengganu'),
  ('7249945b-7899-b290-1579-870092c246ce', '37fb885f-7c7d-7f30-bb23-76900ff15a18', 'https://images.unsplash.com/photo-1790321034818-b2d73ac1529f?w=1280&q=80', 'image', 2, 'Hotel room with two twin beds and dark wooden headboards'),
  ('7249945b-7899-b290-1579-870092c246ce', '37fb885f-7c7d-7f30-bb23-76900ff15a18', 'https://images.unsplash.com/photo-1711059985570-4c32ed12a12c?w=1280&q=80', 'image', 3, 'Bed with white sheets and pillows in a hotel room');

-- ===== Ibis Styles Kota Bharu =====
-- source (about): https://all.accor.com/hotel/9928/index.en.shtml
-- source (amenities): https://all.accor.com/hotel/9928/index.en.shtml
-- source (check-in/out): https://all.accor.com/hotel/9928/index.en.shtml
-- source (policies): https://all.accor.com/hotel/9928/index.en.shtml
-- note: Room mapping: Standard Room = Superior with 2 single beds; Superior Room = Superior with 1 double bed (both 22 sqm); Family Room = Family Room with sofa bed (28 sqm); Suite = Deluxe Suite (44 sqm). Deluxe Room has no official equivalent and is invented. Accor lists no pool or gym, though Trip.com claims both, so they were left out. 24-hour front desk is from Trip.com.
UPDATE public.outlets
SET hotel_about = 'A colourful, design-led economy hotel in Kota Bharu town centre, near the Kelantan River and the state palace. The interiors borrow Kelantan batik patterns, and guests eat at Streats Cafe, serving Kelantanese and international dishes, or the Lobby Cafe. There is also a 150 sqm meeting room, an on-site car park and EV charging.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'front_desk_24h', 'accessible', 'airport_transfer']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and the hotel is 100% non-smoking. Children are welcome; family rooms and suites have a sofa bed for extra guests. A shuttle service is available on request, and a deposit is held on a card at check-in.',
    wheelchair_accessible = true,
    pet_friendly = false
WHERE id = '509c9788-58be-a19a-f35b-7dea3ca23340';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A slightly larger room on a high floor with a city or river outlook.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed", "maxGuests": 3, "sizeSqm": 25, "view": "City or river view, high floor", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Wireless charging dock", "Flat-screen TV", "Coffee and tea making", "Minibar", "In-room safe", "Iron and ironing board", "Free Wi-Fi"]}'::jsonb
WHERE id = 'f7387bb0-eeb1-4062-a8f5-57f45ce715f8';

-- Family Room -- source: https://all.accor.com/hotel/9928/index.en.shtml
UPDATE public.products
SET description = 'A family room with a double bed plus a sofa bed, on the upper floors of the hotel.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed and 1 single sofa bed", "maxGuests": 4, "sizeSqm": 28, "view": "City view, upper floors", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Wireless charging dock", "Flat-screen TV", "Coffee and tea making", "Minibar", "In-room safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '6e275bbd-a953-402e-a391-8cbd835f78e9';

-- Standard Room -- source: https://all.accor.com/hotel/9928/index.en.shtml
UPDATE public.products
SET description = 'A cheerful twin room with batik-inspired decor and two single beds.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 3, "sizeSqm": 22, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Wireless charging dock", "Flat-screen TV", "Coffee and tea making", "In-room safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '787b5a2a-e79a-62f7-a5fa-154fc9d8c7f2';

-- Suite -- source: https://all.accor.com/hotel/9928/index.en.shtml
UPDATE public.products
SET description = 'A spacious suite with a double bed and a double sofa bed, good for small families.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed and 1 double sofa bed", "maxGuests": 4, "sizeSqm": 44, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Separate sitting area", "Air conditioning", "Wireless charging dock", "Flat-screen TV", "Coffee and tea making", "Minibar", "In-room safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '6f899665-5af6-4457-a57a-dcdfb9513313';

-- Superior Room -- source: https://all.accor.com/hotel/9928/index.en.shtml
UPDATE public.products
SET description = 'A bright room with one double bed and colourful Kelantan-inspired touches.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed", "maxGuests": 3, "sizeSqm": 22, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Wireless charging dock", "Flat-screen TV", "Coffee and tea making", "In-room safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '6f6e39a8-da8a-9451-2296-9e386368fb3c';

-- photo 1 (similar hotel, Unsplash License): https://unsplash.com/photos/modern-hotel-building-with-palm-trees-and-lush-greenery-AfKCwCF-SaU
-- photo 2 (similar hotel, Unsplash License): https://unsplash.com/photos/modern-hotel-lobby-with-sleek-reception-desk-and-seating-Accg0bUgp7k
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/p3UWyaujtQo
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/qifUgNsrWmU
DELETE FROM public.media_assets WHERE outlet_id = '509c9788-58be-a19a-f35b-7dea3ca23340' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('c618dbb1-5b08-d7ff-58f7-b86c99af573e', '509c9788-58be-a19a-f35b-7dea3ca23340', 'https://images.unsplash.com/photo-1757840357512-eaeb60d4d353?w=1280&q=80', 'image', -1, 'Modern hotel building with balconies behind palm trees and greenery'),
  ('c618dbb1-5b08-d7ff-58f7-b86c99af573e', '509c9788-58be-a19a-f35b-7dea3ca23340', 'https://images.unsplash.com/photo-1757840357512-eaeb60d4d353?w=1280&q=80', 'image', 0, 'Modern hotel building with balconies behind palm trees and greenery'),
  ('c618dbb1-5b08-d7ff-58f7-b86c99af573e', '509c9788-58be-a19a-f35b-7dea3ca23340', 'https://images.unsplash.com/photo-1758193783649-13371d7fb8dd?w=1280&q=80', 'image', 1, 'Bright hotel lobby with a marble floor, reception desk and lounge seating'),
  ('c618dbb1-5b08-d7ff-58f7-b86c99af573e', '509c9788-58be-a19a-f35b-7dea3ca23340', 'https://images.unsplash.com/photo-1629140727571-9b5c6f6267b4?w=1280&q=80', 'image', 2, 'Modern hotel bedroom with a large bed and floor-length curtains'),
  ('c618dbb1-5b08-d7ff-58f7-b86c99af573e', '509c9788-58be-a19a-f35b-7dea3ca23340', 'https://images.unsplash.com/photo-1711059985570-4c32ed12a12c?w=1280&q=80', 'image', 3, 'Bed with white linen beside a navy wall and pendant lamp');

-- ===== Kuala Selangor Firefly Park Resort =====
-- source (about): https://www.visitselangor.com/?p=2681
-- source (amenities): invented for demo
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: Official domain fireflyparkresort.com is parked/for sale, so the resort may have closed or moved online; filled as if open from the Visit Selangor listing. Riverview Chalet mapped to the official riverbank stilt chalet; other rooms invented. Photos show the Selangor River and a similar wooden-chalet resort, not this resort.
UPDATE public.outlets
SET hotel_about = 'A riverside resort at Kampung Bukit Belimbing, about 1.5 hours'' drive from Kuala Lumpur, with wooden chalets on stilts along the bank of the Selangor River. It runs quiet electric boats from its own floating jetty for evening firefly trips among the riverside trees, and is a good base for Bukit Melawati and seafood dinners in Kuala Selangor.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'restaurant', 'free_parking']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and smoking is only permitted in open areas away from the chalets. Each chalet sleeps up to 4 people, and children must be supervised on the jetty and near the river. Firefly boat rides are charged separately and may be cancelled in heavy rain.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'd6e47737-e7e7-7b29-9bb4-1770b95d3af7';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A roomier resort room with queen or twin beds and a glimpse of the river.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "Partial river view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Coffee and tea making", "Mini fridge"]}'::jsonb
WHERE id = 'c0f8fcf0-e63c-4eea-a79a-6483593fb3a3';

-- Family Chalet -- source: invented for demo
UPDATE public.products
SET description = 'A larger stilt chalet for families, with two bedrooms, a living room and a riverside balcony.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds and 1 single bed", "maxGuests": 5, "sizeSqm": 42, "view": "River view from a balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "Living room", "Air-conditioning", "Hot water shower", "TV", "Free Wi-Fi", "Coffee and tea making"]}'::jsonb
WHERE id = 'f3f786c6-9e75-bea0-8753-10bdf3af7e0c';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with a queen bed and two singles, close to the jetty for firefly trips.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 32, "view": "Garden view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Coffee and tea making", "Wardrobe"]}'::jsonb
WHERE id = 'a118c611-c492-41a6-a27f-b43cbee7aefa';

-- Riverview Chalet -- source: https://www.visitselangor.com/?p=2681
UPDATE public.products
SET description = 'A wooden stilt chalet on the riverbank with a living area and balcony facing the Selangor River.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 4, "sizeSqm": 32, "view": "Selangor River from a private balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "Living area", "Air-conditioning", "Hot water shower", "TV", "Free Wi-Fi", "Coffee and tea making"]}'::jsonb
WHERE id = 'eeaf140d-729e-aae2-09ae-10956841d9e1';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A cosy resort room with a queen bed, set back from the river in the garden.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 20, "view": "Garden view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "TV", "Free Wi-Fi", "Coffee and tea making"]}'::jsonb
WHERE id = '458a6515-16bc-4186-ae93-abee375e38f9';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Wooden_chalet_units_at_Mutiara_Taman_Negara_Resort.jpg
-- photo 2 (similar hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Sunset_@_Selangor_River_(13921329689).jpg
-- photo 3 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Selangor_River_near_Kuala_Selangor_(230316).jpg
-- photo 4 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Bed_in_hotel_room_2.jpg
DELETE FROM public.media_assets WHERE outlet_id = 'd6e47737-e7e7-7b29-9bb4-1770b95d3af7' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('ce7bc406-9e49-641a-66da-add83c4f83a5', 'd6e47737-e7e7-7b29-9bb4-1770b95d3af7', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Wooden_chalet_units_at_Mutiara_Taman_Negara_Resort.jpg/1280px-Wooden_chalet_units_at_Mutiara_Taman_Negara_Resort.jpg', 'image', -1, 'Wooden chalets among tall trees at a Malaysian nature resort'),
  ('ce7bc406-9e49-641a-66da-add83c4f83a5', 'd6e47737-e7e7-7b29-9bb4-1770b95d3af7', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Wooden_chalet_units_at_Mutiara_Taman_Negara_Resort.jpg/1280px-Wooden_chalet_units_at_Mutiara_Taman_Negara_Resort.jpg', 'image', 0, 'Wooden chalets among tall trees at a Malaysian nature resort'),
  ('ce7bc406-9e49-641a-66da-add83c4f83a5', 'd6e47737-e7e7-7b29-9bb4-1770b95d3af7', 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Sunset_%40_Selangor_River_%2813921329689%29.jpg/1280px-Sunset_%40_Selangor_River_%2813921329689%29.jpg', 'image', 1, 'Sunset over the Selangor River'),
  ('ce7bc406-9e49-641a-66da-add83c4f83a5', 'd6e47737-e7e7-7b29-9bb4-1770b95d3af7', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Selangor_River_near_Kuala_Selangor_%28230316%29.jpg/1280px-Selangor_River_near_Kuala_Selangor_%28230316%29.jpg', 'image', 2, 'Selangor River near Kuala Selangor under a blue sky'),
  ('ce7bc406-9e49-641a-66da-add83c4f83a5', 'd6e47737-e7e7-7b29-9bb4-1770b95d3af7', 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Bed_in_hotel_room_2.jpg/1280px-Bed_in_hotel_room_2.jpg', 'image', 3, 'Guest room with a queen bed and bedside lamps');

-- ===== Legoland Hotel Malaysia =====
-- source (about): https://www.legoland.com.my/plan-your-day/help-center/faq/legoland-hotel-general-information/
-- source (amenities): https://www.legoland.com.my/plan-your-day/help-center/faq/legoland-hotel-general-information/
-- source (check-in/out): https://www.legoland.com.my/plan-your-day/help-center/faq/legoland-hotel-general-information/
-- source (policies): https://www.legoland.com.my/plan-your-day/help-center/faq/legoland-hotel-general-information/
-- note: Room sizes from Trip.com (premium 34-38 sqm, Kingdom Suite 70 sqm); booking sites disagree slightly. Standard themed room size estimated. Official FAQ gives Deluxe/Suite occupancy up to 8.
UPDATE public.outlets
SET hotel_about = 'Malaysia''s first LEGO-themed hotel, right at the entrance of LEGOLAND Malaysia Resort in Iskandar Puteri, Johor. Its 263 rooms come in Pirate, Kingdom, Adventure, NINJAGO and Friends themes, and families can enjoy a lifeguarded pool, play areas and four dining outlets including Bricks Family Restaurant.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'restaurant', 'breakfast', 'free_parking', 'front_desk_24h', 'air_conditioning', 'accessible']::text[],
    check_in_time = '16:00',
    check_out_time = '11:00',
    stay_policies = 'Pets are not allowed. Themed and premium rooms take up to 5 guests (3 adults and 2 children or 2 adults and 3 children), and cribs are available on request. Breakfast at Bricks is included except on room-only rates, parking is covered by the resort fee, and late check-out carries a charge.',
    wheelchair_accessible = true,
    pet_friendly = false
WHERE id = '870c05e3-813a-6d95-fc35-b1458d82f66e';

-- LEGOLAND Hotel Adventure Premium Room -- source: https://nz.trip.com/hotels/nusajaya-hotel-detail-1933570/legoland-resort-hotel-johor-bahru
UPDATE public.products
SET description = 'A premium Adventure room with extra LEGO models and a separate kids'' sleeping area.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 bunk bed with trundle", "maxGuests": 5, "sizeSqm": 38, "view": "Resort or park view", "smoking": "non_smoking", "roomAmenities": ["LEGO-themed decor", "Separate kids'' bunk area", "Treasure hunt with prize", "Free LEGO bricks to play with", "Flat-screen TV", "Free Wi-Fi", "Coffee and tea making", "Mini fridge"]}'::jsonb
WHERE id = 'c5b2fc2b-c9f1-4a9c-a32a-60f1f6e202cd';

-- LEGOLAND Hotel Kingdom Premium Room -- source: https://nz.trip.com/hotels/nusajaya-hotel-detail-1933570/legoland-resort-hotel-johor-bahru
UPDATE public.products
SET description = 'A premium Kingdom room fit for knights and princesses, with separate adult and kids'' zones.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 bunk bed with trundle", "maxGuests": 5, "sizeSqm": 38, "view": "Resort or park view", "smoking": "non_smoking", "roomAmenities": ["LEGO-themed decor", "Separate kids'' bunk area", "Treasure hunt with prize", "Free LEGO bricks to play with", "Flat-screen TV", "Free Wi-Fi", "Coffee and tea making", "Mini fridge"]}'::jsonb
WHERE id = '6ea0f841-5387-4025-abaf-0dda6a7684f8';

-- LEGOLAND Hotel Kingdom Suite -- source: https://nz.trip.com/hotels/nusajaya-hotel-detail-1933570/legoland-resort-hotel-johor-bahru
UPDATE public.products
SET description = 'A large Kingdom Suite with two bunk beds, a bathtub and room for the whole family.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 bunk beds", "maxGuests": 8, "sizeSqm": 70, "view": "Resort or park view", "smoking": "non_smoking", "roomAmenities": ["LEGO-themed decor", "Separate kids'' bunk area", "Treasure hunt with prize", "Free LEGO bricks to play with", "Flat-screen TV", "Free Wi-Fi", "Coffee and tea making", "Mini fridge", "Bathtub"]}'::jsonb
WHERE id = '69061f00-36c7-4fee-ad84-81fcfdf267a1';

-- LEGOLAND Hotel NINJAGO Premium Room -- source: https://www.legoland.com.my/plan-your-day/help-center/faq/legoland-hotel-general-information/
UPDATE public.products
SET description = 'A premium NINJAGO room styled after the ninja series, with a bunk area for young fans.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 bunk bed with trundle", "maxGuests": 5, "sizeSqm": 38, "view": "Resort or park view", "smoking": "non_smoking", "roomAmenities": ["LEGO-themed decor", "Separate kids'' bunk area", "Treasure hunt with prize", "Free LEGO bricks to play with", "Flat-screen TV", "Free Wi-Fi", "Coffee and tea making", "Mini fridge"]}'::jsonb
WHERE id = 'eb1d2d73-e51b-4cc9-a722-ec061df0c794';

-- LEGOLAND Hotel Pirate Premium Room -- source: https://nz.trip.com/hotels/nusajaya-hotel-detail-1933570/legoland-resort-hotel-johor-bahru
UPDATE public.products
SET description = 'A premium Pirate room with ship-style decor and extra LEGO details throughout.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 bunk bed with trundle", "maxGuests": 5, "sizeSqm": 38, "view": "Resort or park view", "smoking": "non_smoking", "roomAmenities": ["LEGO-themed decor", "Separate kids'' bunk area", "Treasure hunt with prize", "Free LEGO bricks to play with", "Flat-screen TV", "Free Wi-Fi", "Coffee and tea making", "Mini fridge"]}'::jsonb
WHERE id = '45711b65-44cd-4a7a-a1e0-c6613c52a3d0';

-- Legoland Adventure Room -- source: https://www.legoland.com.my/plan-your-day/help-center/faq/legoland-hotel-general-information/
UPDATE public.products
SET description = 'An Adventure-themed room with jungle explorer decor and a bunk nook for the kids.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 bunk bed with trundle", "maxGuests": 5, "sizeSqm": 34, "view": "Resort or park view", "smoking": "non_smoking", "roomAmenities": ["LEGO-themed decor", "Separate kids'' bunk area", "Treasure hunt with prize", "Free LEGO bricks to play with", "Flat-screen TV", "Free Wi-Fi", "Coffee and tea making", "Mini fridge"]}'::jsonb
WHERE id = '1611cf49-cc7a-0161-0e84-7e3c3e03abc9';

-- Legoland Pirate Room -- source: https://www.legoland.com.my/plan-your-day/help-center/faq/legoland-hotel-general-information/
UPDATE public.products
SET description = 'A Pirate-themed room with nautical decor; connecting rooms are available for bigger groups.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 bunk bed with trundle", "maxGuests": 5, "sizeSqm": 34, "view": "Resort or park view", "smoking": "non_smoking", "roomAmenities": ["LEGO-themed decor", "Separate kids'' bunk area", "Treasure hunt with prize", "Free LEGO bricks to play with", "Flat-screen TV", "Free Wi-Fi", "Coffee and tea making", "Mini fridge"]}'::jsonb
WHERE id = '6729ca99-889e-142f-842a-96ff705daffa';

-- photo 1 (this hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Legoland_Malaysia_Resort_(23493876176).jpg
-- photo 2 (this hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Legoland_Malaysia_Resort_(23489962546).jpg
-- photo 3 (this hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Legoland_Malaysia_Resort_(22866593063).jpg
-- photo 4 (this hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Legoland_Malaysia_Resort_(23437370851).jpg
DELETE FROM public.media_assets WHERE outlet_id = '870c05e3-813a-6d95-fc35-b1458d82f66e' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('1981c34a-47c6-f73b-2285-ccd590003575', '870c05e3-813a-6d95-fc35-b1458d82f66e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Legoland_Malaysia_Resort_%2823493876176%29.jpg/1280px-Legoland_Malaysia_Resort_%2823493876176%29.jpg', 'image', -1, 'Colourful LEGO-style facade of LEGOLAND Hotel Malaysia behind palm trees'),
  ('1981c34a-47c6-f73b-2285-ccd590003575', '870c05e3-813a-6d95-fc35-b1458d82f66e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Legoland_Malaysia_Resort_%2823493876176%29.jpg/1280px-Legoland_Malaysia_Resort_%2823493876176%29.jpg', 'image', 0, 'Colourful LEGO-style facade of LEGOLAND Hotel Malaysia behind palm trees'),
  ('1981c34a-47c6-f73b-2285-ccd590003575', '870c05e3-813a-6d95-fc35-b1458d82f66e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Legoland_Malaysia_Resort_%2823489962546%29.jpg/1280px-Legoland_Malaysia_Resort_%2823489962546%29.jpg', 'image', 1, 'Brick-patterned tower of LEGOLAND Hotel Malaysia'),
  ('1981c34a-47c6-f73b-2285-ccd590003575', '870c05e3-813a-6d95-fc35-b1458d82f66e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Legoland_Malaysia_Resort_%2822866593063%29.jpg/1280px-Legoland_Malaysia_Resort_%2822866593063%29.jpg', 'image', 2, 'LEGOLAND Hotel Malaysia beside the resort plaza'),
  ('1981c34a-47c6-f73b-2285-ccd590003575', '870c05e3-813a-6d95-fc35-b1458d82f66e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Legoland_Malaysia_Resort_%2823437370851%29.jpg/1280px-Legoland_Malaysia_Resort_%2823437370851%29.jpg', 'image', 3, 'Covered walkway leading to LEGOLAND Hotel Malaysia');

-- ===== Lexis Hibiscus Port Dickson =====
-- source (about): https://www.imfirstclass.com/en/stories/1099/
-- source (amenities): https://www.expedia.com/Port-Dickson-Hotels-Lexis-Hibiscus-Port-Dickson.h9988049.Hotel-Information
-- source (check-in/out): https://www.expedia.com/Port-Dickson-Hotels-Lexis-Hibiscus-Port-Dickson.h9988049.Hotel-Information
-- source (policies): invented for demo
-- note: Official Lexis site was unreachable (lexishibiscus.com.my is a property-investment page). Mapping: Superior Room = Sky Pool Villa (tower, size guessed); Deluxe Room = Executive Pool Villa (764 sq ft); Family Room = Executive Pool Villa with 2 king beds (sleeps 4); Private Pool Villa = Premium Pool Villa (size guessed); Hibiscus Villa = Panorama Pool Villa (926 sq ft). Every unit here has a private pool, so 'Private Pool Villa' is not unique.
UPDATE public.outlets
SET hotel_about = 'A five-star resort off Port Dickson with overwater villas laid out in the shape of Malaysia''s national flower, the hibiscus. All of its roughly 639 villas and tower units come with a private pool and steam room, earning Guinness records for most pools and most overwater villas. Dining includes Umi Japanese, Wave and the Roselle Coffee House buffet, plus a spa and a pool bar.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'gym', 'restaurant', 'breakfast', 'free_parking', 'front_desk_24h', 'laundry', 'air_conditioning']::text[],
    check_in_time = '15:00',
    check_out_time = '11:00',
    stay_policies = 'Guests must be 18 or older to check in, and Panorama Pool Villa guests check in at the Lighthouse bar. Pets are not allowed and smoking is limited to villa balconies and outdoor areas. Children under 12 stay free using existing beds; a refundable deposit is collected per villa at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '9983ef16-4b9b-3d5a-a03e-c203e3ae83fb';

-- Deluxe Room -- source: https://www.expedia.com/Port-Dickson-Hotels-Lexis-Hibiscus-Port-Dickson.h9988049.Hotel-Information
UPDATE public.products
SET description = 'An overwater villa with a private plunge pool, steam room and a glass floor panel above the sea.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 71, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Private pool", "Steam room", "Glass floor panel", "Bathtub and rain shower", "Flat-screen TV", "Coffee and tea making", "Minibar (chargeable)", "Free Wi-Fi"]}'::jsonb
WHERE id = '2c4652b8-0330-48c4-a583-acc8216e7d37';

-- Family Room -- source: https://www.expedia.com/Port-Dickson-Hotels-Lexis-Hibiscus-Port-Dickson.h9988049.Hotel-Information
UPDATE public.products
SET description = 'An overwater pool villa with two king beds, sleeping a family of four above the Strait of Malacca.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 king beds", "maxGuests": 4, "sizeSqm": 71, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Private pool", "Steam room", "Glass floor panel", "Bathtub and rain shower", "Flat-screen TV", "Coffee and tea making", "Minibar (chargeable)", "Free Wi-Fi"]}'::jsonb
WHERE id = '0c886821-857c-4362-a178-bd0438dc0b43';

-- Hibiscus Villa -- source: https://www.expedia.com/Port-Dickson-Hotels-Lexis-Hibiscus-Port-Dickson.h9988049.Hotel-Information
UPDATE public.products
SET description = 'A villa on the outer ring of the hibiscus with open sea panoramas and private Lighthouse check-in.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 86, "view": "Panoramic sea view", "smoking": "non_smoking", "roomAmenities": ["Private pool", "Steam room", "Panoramic windows", "Bathtub and rain shower", "Flat-screen TV", "Coffee machine", "Minibar (chargeable)", "Free Wi-Fi"]}'::jsonb
WHERE id = 'c47b238c-0133-e58e-3daf-6c027c929e3f';

-- Private Pool Villa -- source: https://www.imfirstclass.com/en/stories/1099/
UPDATE public.products
SET description = 'A sea-facing pool villa with floor-to-ceiling glass windows and a larger private pool deck.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 76, "view": "Sea-facing", "smoking": "non_smoking", "roomAmenities": ["Private pool with deck", "Steam room", "Floor-to-ceiling windows", "Bathtub and rain shower", "Flat-screen TV", "Coffee machine", "Minibar (chargeable)", "Free Wi-Fi"]}'::jsonb
WHERE id = 'e017e6e3-c42c-cc27-ddf5-48988b2350f3';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A tower-block unit with its own sky pool on the balcony and views over the hibiscus-shaped villas.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 2, "sizeSqm": 65, "view": "Sea and resort view", "smoking": "non_smoking", "roomAmenities": ["Private balcony pool", "Steam room", "Bathtub and rain shower", "Flat-screen TV", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = 'f7dd0678-cadb-4695-a31c-b79d425f6a7c';

-- photo 1 (this hotel, CC0): https://commons.wikimedia.org/wiki/File:Lexis_Hibiscus_Port_Dickson.jpg
-- photo 2 (similar hotel, Unsplash License): https://unsplash.com/photos/woman-in-overwater-villa-pool-TEFh8ZXe57k
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/overwater-bungalows-line-a-wooden-path-dejzecdfEwE
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/contemporary-bedroom-with-a-gray-bed-and-illuminated-bedside-table-Nu08FTEs6ko
DELETE FROM public.media_assets WHERE outlet_id = '9983ef16-4b9b-3d5a-a03e-c203e3ae83fb' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('085b2bef-d75f-f2d6-c4ab-130c0d2cd6b5', '9983ef16-4b9b-3d5a-a03e-c203e3ae83fb', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Lexis_Hibiscus_Port_Dickson.jpg/1280px-Lexis_Hibiscus_Port_Dickson.jpg', 'image', -1, 'Lexis Hibiscus Port Dickson overwater villas in the sea'),
  ('085b2bef-d75f-f2d6-c4ab-130c0d2cd6b5', '9983ef16-4b9b-3d5a-a03e-c203e3ae83fb', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Lexis_Hibiscus_Port_Dickson.jpg/1280px-Lexis_Hibiscus_Port_Dickson.jpg', 'image', 0, 'Lexis Hibiscus Port Dickson overwater villas in the sea'),
  ('085b2bef-d75f-f2d6-c4ab-130c0d2cd6b5', '9983ef16-4b9b-3d5a-a03e-c203e3ae83fb', 'https://images.unsplash.com/photo-1787143061724-21dbe51822bf?w=1280&q=80', 'image', 1, 'Guest standing in the private pool of an overwater villa'),
  ('085b2bef-d75f-f2d6-c4ab-130c0d2cd6b5', '9983ef16-4b9b-3d5a-a03e-c203e3ae83fb', 'https://images.unsplash.com/photo-1743356174397-d6da6f014f8f?w=1280&q=80', 'image', 2, 'Overwater bungalows along a wooden walkway'),
  ('085b2bef-d75f-f2d6-c4ab-130c0d2cd6b5', '9983ef16-4b9b-3d5a-a03e-c203e3ae83fb', 'https://images.unsplash.com/photo-1782397150139-bc40471f07c0?w=1280&q=80', 'image', 3, 'Contemporary villa bedroom with a grey bed and lit bedside table');

-- ===== Palm Seremban Hotel =====
-- source (about): https://hotels.com/ho478260/palm-seremban-hotel-seremban-malaysia
-- source (amenities): https://hotels.com/ho478260/palm-seremban-hotel-seremban-malaysia
-- source (check-in/out): https://hotels.com/ho478260/palm-seremban-hotel-seremban-malaysia
-- source (policies): https://hotels.com/ho478260/palm-seremban-hotel-seremban-malaysia
-- note: No official website found; facts come from Hotels.com. Only the Deluxe Room (about 301 sq ft, two queen beds) is documented; the other room sizes are estimates. Listings conflict on parking (none vs paid), so parking was left out of the amenities. No openly licensed photos of the hotel exist.
UPDATE public.outlets
SET hotel_about = 'A three-star city hotel in Kemayan Square, Seremban, next to Palm Mall for easy shopping and dining. Its 189 rooms suit business and family travellers, and the hotel has the Sago Coffee House for buffet breakfast and local meals, a bar lounge, meeting and conference rooms, and a 24-hour front desk.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'front_desk_24h', 'laundry']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'Guests must be 18 or older to check in, and a MYR50 deposit plus photo ID are required. Pets are not allowed. Rollaway beds cost MYR50 per night and cots are not available. Breakfast is a paid buffet served 6:30am to 10:30am.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '47c3cf6a-2196-130d-4df9-59f1ccdb1290';

-- Deluxe Room -- source: https://hotels.com/ho478260/palm-seremban-hotel-seremban-malaysia
UPDATE public.products
SET description = 'A roomy city room with two queen beds, a 40-inch TV and a rainfall shower.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 3, "sizeSqm": 28, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["40-inch LED TV", "Rainfall shower", "Air conditioning", "Coffee and tea making", "Minibar (chargeable)", "In-room safe", "Free Wi-Fi"]}'::jsonb
WHERE id = 'a6b448e2-a92b-f11a-d004-ba00f6f007bf';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A larger room for families with space for four, close to Palm Mall.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 4, "sizeSqm": 34, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["LED TV", "Rainfall shower", "Air conditioning", "Coffee and tea making", "Minibar (chargeable)", "In-room safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '0337a2d8-368b-4f5b-aabd-f7087386dda6';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A simple, good-value room with the essentials for an overnight stay.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 20, "view": "City or inner view", "smoking": "non_smoking", "roomAmenities": ["LED TV", "Air conditioning", "Coffee and tea making", "In-room safe", "Free Wi-Fi", "Shower"]}'::jsonb
WHERE id = '637f75ba-f50d-2014-fae9-367817f5334a';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'A suite with a separate living area, suited to longer stays or small celebrations.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 48, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Separate living area", "40-inch LED TV", "Bathtub and rainfall shower", "Air conditioning", "Coffee and tea making", "Minibar (chargeable)", "In-room safe", "Free Wi-Fi"]}'::jsonb
WHERE id = 'ae9bf83c-29fc-4462-a586-6500ebb7568d';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A comfortable room with a work desk, one step up from Standard.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["LED TV", "Work desk", "Air conditioning", "Coffee and tea making", "Minibar (chargeable)", "In-room safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '4d5f85aa-cab0-4029-a8f6-3940bf2566e5';

-- photo 1 (similar hotel, Unsplash License): https://unsplash.com/photos/palm-trees-line-the-street-in-front-of-a-hotel-yPfpzdcnv0k
-- photo 2 (similar hotel, Unsplash License): https://unsplash.com/photos/modern-lobby-lounge-with-city-view-DfzzpBRZCT0
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/oxeCZrodz78
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/4Zt87dYGpAE
DELETE FROM public.media_assets WHERE outlet_id = '47c3cf6a-2196-130d-4df9-59f1ccdb1290' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('c56e1baa-1644-ab2c-e934-74a3dd62338f', '47c3cf6a-2196-130d-4df9-59f1ccdb1290', 'https://images.unsplash.com/photo-1690314749019-2754cc7bfac9?w=1280&q=80', 'image', -1, 'White hotel building behind a row of tall palm trees'),
  ('c56e1baa-1644-ab2c-e934-74a3dd62338f', '47c3cf6a-2196-130d-4df9-59f1ccdb1290', 'https://images.unsplash.com/photo-1690314749019-2754cc7bfac9?w=1280&q=80', 'image', 0, 'White hotel building behind a row of tall palm trees'),
  ('c56e1baa-1644-ab2c-e934-74a3dd62338f', '47c3cf6a-2196-130d-4df9-59f1ccdb1290', 'https://images.unsplash.com/photo-1587702068694-a909ef4aa346?w=1280&q=80', 'image', 1, 'Hotel lobby lounge with leather sofas and tall windows onto the street'),
  ('c56e1baa-1644-ab2c-e934-74a3dd62338f', '47c3cf6a-2196-130d-4df9-59f1ccdb1290', 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1280&q=80', 'image', 2, 'City hotel room with a large bed, upholstered headboard and window'),
  ('c56e1baa-1644-ab2c-e934-74a3dd62338f', '47c3cf6a-2196-130d-4df9-59f1ccdb1290', 'https://images.unsplash.com/photo-1671037198031-5d8b12d3d2b1?w=1280&q=80', 'image', 3, 'Hotel room with two beds and warm bedside lamps');

-- ===== Pasir Belanda =====
-- source (about): https://www.pasirbelanda.com/
-- source (amenities): https://www.pasirbelanda.com/facilities/
-- source (check-in/out): invented for demo
-- source (policies): https://www.pasirbelanda.com/chalets/
-- note: Garden Chalet mapped to the official Superior Chalet (17 sqm, RM257 nett for 2 in 2024). The site lists only one chalet type, so Deluxe Chalet is invented. Pets, smoking and dress rules are invented. New owner and location since December 2018. Photos show similar traditional Malay houses and a Kota Bharu landmark, not the property.
UPDATE public.outlets
SET hotel_about = 'A kampung-style retreat at Kampung Kijang on the road to Pantai Cahaya Bulan, a short drive from central Kota Bharu, where carpenter-built wooden chalets stand in a Malay family''s landscaped garden. Guests live among villagers, can borrow bicycles, play table tennis, wander the fruit orchard and join cycling or river trips to nearby villages.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'free_parking']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Each chalet has one double bed for two guests, and up to two extra beds or mattresses can be added for a nightly charge. A surcharge applies in July and August. Pets are not allowed, smoking is outdoors only, and guests are asked to dress modestly out of respect for the village community.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '6d12b3fa-a591-3a2c-a441-f8cc3ad4a85c';

-- Deluxe Chalet -- source: invented for demo
UPDATE public.products
SET description = 'A larger wooden chalet with a queen bed, a single bed and a shaded veranda over the orchard.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 1 single bed", "maxGuests": 4, "sizeSqm": 24, "view": "Orchard view from a veranda", "smoking": "non_smoking", "roomAmenities": ["Private veranda", "Air-conditioning", "Hot shower", "Coffee and tea making", "Free Wi-Fi", "Private bathroom", "Extra mattress on request"]}'::jsonb
WHERE id = '6718ed5d-43f3-0e37-261f-a7cef801449f';

-- Garden Chalet -- source: https://www.pasirbelanda.com/chalets/
UPDATE public.products
SET description = 'A carpenter-built wooden chalet in the hosts'' garden, with a double bed and a hot shower.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed (up to 2 extra beds on request)", "maxGuests": 4, "sizeSqm": 17, "view": "Garden view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Hot shower", "Coffee and tea making", "Free Wi-Fi", "Private bathroom", "Extra mattress on request"]}'::jsonb
WHERE id = '3f237f47-31cd-b64d-3b6c-bd256848bd79';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Malaysia_Heritage_Studios_Kelantan_House.jpg
-- photo 2 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Traditional_Negri_kampung_house.jpg
-- photo 3 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Traditional_Negri_kampung_house_(2).jpg
-- photo 4 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Istana_Jahar,_Kota_Bharu.jpg
DELETE FROM public.media_assets WHERE outlet_id = '6d12b3fa-a591-3a2c-a441-f8cc3ad4a85c' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('ee892746-e8fd-02ed-43b6-1b31ff902f6e', '6d12b3fa-a591-3a2c-a441-f8cc3ad4a85c', 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Malaysia_Heritage_Studios_Kelantan_House.jpg/1280px-Malaysia_Heritage_Studios_Kelantan_House.jpg', 'image', -1, 'Traditional Kelantan-style wooden house on stilts with a veranda'),
  ('ee892746-e8fd-02ed-43b6-1b31ff902f6e', '6d12b3fa-a591-3a2c-a441-f8cc3ad4a85c', 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Malaysia_Heritage_Studios_Kelantan_House.jpg/1280px-Malaysia_Heritage_Studios_Kelantan_House.jpg', 'image', 0, 'Traditional Kelantan-style wooden house on stilts with a veranda'),
  ('ee892746-e8fd-02ed-43b6-1b31ff902f6e', '6d12b3fa-a591-3a2c-a441-f8cc3ad4a85c', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Traditional_Negri_kampung_house.jpg/1280px-Traditional_Negri_kampung_house.jpg', 'image', 1, 'Traditional Malay kampung house with a high timber roof'),
  ('ee892746-e8fd-02ed-43b6-1b31ff902f6e', '6d12b3fa-a591-3a2c-a441-f8cc3ad4a85c', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Traditional_Negri_kampung_house_%282%29.jpg/1280px-Traditional_Negri_kampung_house_%282%29.jpg', 'image', 2, 'Wooden village house among banana trees with hills behind'),
  ('ee892746-e8fd-02ed-43b6-1b31ff902f6e', '6d12b3fa-a591-3a2c-a441-f8cc3ad4a85c', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Istana_Jahar%2C_Kota_Bharu.jpg/1280px-Istana_Jahar%2C_Kota_Bharu.jpg', 'image', 3, 'Istana Jahar, a historic wooden palace museum in Kota Bharu');

-- ===== Pelangi Beach Resort & Spa =====
-- photo 1 (similar hotel, Unsplash License): https://unsplash.com/photos/white-and-brown-wooden-house-near-swimming-pool-during-daytime-jetnF4Xv4h8
-- photo 2 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Pantai_Cenang_Beach_at_sunset.jpg
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/brown-wooden-lounge-chairs-near-pool-surrounded-by-palm-trees-vmIWr0NnpCQ
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/hotel-bedroom-with-wooden-bed-T5pL6ciEn-I
DELETE FROM public.media_assets WHERE outlet_id = '5016d273-eb84-d20d-81ab-f9022bf401fa' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('7aec736a-a9df-1dfe-e7f2-683dc3694b1a', '5016d273-eb84-d20d-81ab-f9022bf401fa', 'https://images.unsplash.com/photo-1596178067639-5c6e68aea6dc?w=1280&q=80', 'image', -1, 'Wooden chalet-style villa beside a swimming pool'),
  ('7aec736a-a9df-1dfe-e7f2-683dc3694b1a', '5016d273-eb84-d20d-81ab-f9022bf401fa', 'https://images.unsplash.com/photo-1596178067639-5c6e68aea6dc?w=1280&q=80', 'image', 0, 'Wooden chalet-style villa beside a swimming pool'),
  ('7aec736a-a9df-1dfe-e7f2-683dc3694b1a', '5016d273-eb84-d20d-81ab-f9022bf401fa', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Pantai_Cenang_Beach_at_sunset.jpg/1280px-Pantai_Cenang_Beach_at_sunset.jpg', 'image', 1, 'Aerial view of Pantai Cenang beach at sunset'),
  ('7aec736a-a9df-1dfe-e7f2-683dc3694b1a', '5016d273-eb84-d20d-81ab-f9022bf401fa', 'https://images.unsplash.com/photo-1549294413-26f195200c16?w=1280&q=80', 'image', 2, 'Wooden lounge chairs by a pool surrounded by palm trees'),
  ('7aec736a-a9df-1dfe-e7f2-683dc3694b1a', '5016d273-eb84-d20d-81ab-f9022bf401fa', 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1280&q=80', 'image', 3, 'Resort bedroom with a wooden bed, teal pillows and a garden view');

-- ===== Pine Beach =====
-- source (about): https://www.frommers.com/destinations/kuantan/hotels/
-- source (amenities): https://www.frommers.com/destinations/kuantan/hotels/
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: Listed as Hotel Pine Beach on Frommer's (basic rooms, TC Curry House restaurant); no official site, current status unclear (may now trade as TC Beach Hotel). Most room and policy details invented. Photos show Teluk Cempedak beach and a similar budget room, not the hotel.
UPDATE public.outlets
SET hotel_about = 'A simple, no-frills hotel right beside the sand at Teluk Cempedak, Kuantan''s best-known beach about 5 km from the town centre. Rooms are basic but air-conditioned, and the on-site TC Curry House serves local and Indian food, with the beach boardwalk and seafront stalls just steps away.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'free_parking', 'air_conditioning']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and smoking is permitted only in outdoor areas. One extra mattress can be added for a small fee, and children under 6 stay free using existing beds. A cash deposit is collected at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '86b47061-ed39-38d0-0138-1e4a238cd42b';

-- Beachfront Double Room -- source: invented for demo
UPDATE public.products
SET description = 'A double room facing the beach, a few steps from the sand at Teluk Cempedak.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 20, "view": "Beach view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV", "Free drinking water", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'cb47ac61-9035-12cb-7e02-a2d8b0405fe3';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A roomier deluxe room with a small seating corner, close to the shore.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 3, "sizeSqm": 24, "view": "Partial sea view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV", "Free drinking water", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '24ee2386-1a35-4d4c-a79e-4b7640f674dd';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with two beds, handy for beach days with the kids.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 30, "view": "Garden or partial sea view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV", "Free drinking water", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '019db9b1-3ed4-4637-a23b-280f794bcefa';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'The largest room in the hotel, with a separate sitting area and sea outlook.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 36, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV", "Free drinking water", "Hot shower", "Free Wi-Fi", "Daily housekeeping", "Sitting area", "Mini fridge"]}'::jsonb
WHERE id = 'fa36a40e-6340-4546-aa65-421f94f37c96';

-- Superior Room -- source: https://www.frommers.com/destinations/kuantan/hotels/
UPDATE public.products
SET description = 'A basic air-conditioned room with TV, suited to budget travellers.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed", "maxGuests": 2, "sizeSqm": 16, "view": "Inner or garden view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "TV", "Free drinking water", "Hot shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '01834e23-7488-47e9-a19f-232eba2e5c7f';

-- photo 1 (similar hotel, Public domain): https://commons.wikimedia.org/wiki/File:Teluk_Cempedak_pantai.jpg
-- photo 2 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Kuantan_-_rocks_on_the_beach_at_Teluk_Cempedak_-_May_2024.jpg
-- photo 3 (similar hotel, Public domain): https://commons.wikimedia.org/wiki/File:Teluk_Cempedak_titian.jpg
-- photo 4 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Bed_in_hotel_room_4.jpg
DELETE FROM public.media_assets WHERE outlet_id = '86b47061-ed39-38d0-0138-1e4a238cd42b' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('208aea6d-6a9e-e315-7be8-af985acc9a9b', '86b47061-ed39-38d0-0138-1e4a238cd42b', 'https://upload.wikimedia.org/wikipedia/commons/e/eb/Teluk_Cempedak_pantai.jpg', 'image', -1, 'Sandy beach at Teluk Cempedak, Kuantan, lined with trees'),
  ('208aea6d-6a9e-e315-7be8-af985acc9a9b', '86b47061-ed39-38d0-0138-1e4a238cd42b', 'https://upload.wikimedia.org/wikipedia/commons/e/eb/Teluk_Cempedak_pantai.jpg', 'image', 0, 'Sandy beach at Teluk Cempedak, Kuantan, lined with trees'),
  ('208aea6d-6a9e-e315-7be8-af985acc9a9b', '86b47061-ed39-38d0-0138-1e4a238cd42b', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Kuantan_-_rocks_on_the_beach_at_Teluk_Cempedak_-_May_2024.jpg/1280px-Kuantan_-_rocks_on_the_beach_at_Teluk_Cempedak_-_May_2024.jpg', 'image', 1, 'Granite boulders on the shore at Teluk Cempedak'),
  ('208aea6d-6a9e-e315-7be8-af985acc9a9b', '86b47061-ed39-38d0-0138-1e4a238cd42b', 'https://upload.wikimedia.org/wikipedia/commons/5/55/Teluk_Cempedak_titian.jpg', 'image', 2, 'Seaside boardwalk along the rocks at Teluk Cempedak'),
  ('208aea6d-6a9e-e315-7be8-af985acc9a9b', '86b47061-ed39-38d0-0138-1e4a238cd42b', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Bed_in_hotel_room_4.jpg/1280px-Bed_in_hotel_room_4.jpg', 'image', 3, 'Simple hotel room with a double bed and air-conditioning unit');

-- ===== Planters Hotel =====
-- source (about): https://www.travelfish.org/accommodation_profile/malaysia/peninsular_malaysia/pahang/cameron_highlands/all/8816
-- source (amenities): invented for demo
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: Planters Hotel (Jalan Besar 44-A, Tanah Rata) now appears on booking sites as 'OYO Capital O 89695 Planters Hotel'; filled as open under the original name. Not to be confused with Planters Country Hotel. Listings show Standard, Deluxe, Suite Superior and Suite Family types: Family Room = Suite Family, Suite = Suite Superior. Sizes invented. No Commons photos of the hotel exist.
UPDATE public.outlets
SET hotel_about = 'An older mid-range hotel on Jalan Besar in the middle of Tanah Rata, steps from the town''s cafés, bus station and jungle trail starting points in the Cameron Highlands. Rooms are dated but generously sized, the building has lifts to the upper floors, and the location makes it easy to reach tea estates and strawberry farms by bus or taxi.',
    amenity_codes = ARRAY['wifi', 'free_parking', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all rooms are non-smoking. Children under 6 stay free using existing beds, and extra beds can be requested for a small fee. Rooms facing Jalan Besar can pick up traffic noise, so light sleepers should ask for a rear room.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'd7f630a8-373a-5b44-d829-0d354e1cfd0d';

-- Deluxe Room -- source: https://www.travelfish.org/accommodation_profile/malaysia/peninsular_malaysia/pahang/cameron_highlands/all/8816
UPDATE public.products
SET description = 'A spacious deluxe room with a king bed, worth the small upgrade over a standard room.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 26, "view": "Hill view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Flat-screen TV", "Kettle with tea and coffee", "Extra blankets", "Seating area", "Free Wi-Fi"]}'::jsonb
WHERE id = 'e9ff8e24-65ec-410f-acea-1b41d09701bc';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family suite with a double bed and two singles, sleeping four in the cool highland air.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed and 2 single beds", "maxGuests": 4, "sizeSqm": 34, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Flat-screen TV", "Kettle with tea and coffee", "Extra blankets", "Seating area", "Free Wi-Fi"]}'::jsonb
WHERE id = '171de5bb-36de-48ee-a397-08570f633fea';

-- Planters Standard Room -- source: https://www.travelfish.org/accommodation_profile/malaysia/peninsular_malaysia/pahang/cameron_highlands/all/8816
UPDATE public.products
SET description = 'A basic double or twin room with an attached bathroom, a budget base for exploring Tanah Rata.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed or 2 single beds", "maxGuests": 2, "sizeSqm": 18, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Flat-screen TV", "Kettle with tea and coffee", "Extra blankets", "Free Wi-Fi"]}'::jsonb
WHERE id = 'd61f860f-9661-095a-9496-4bdab23eb097';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'The largest room type, with a king bed and a separate lounge corner overlooking the hills.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 40, "view": "Hill view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Separate lounge area", "Flat-screen TV", "Kettle with tea and coffee", "Extra blankets", "Mini fridge", "Free Wi-Fi"]}'::jsonb
WHERE id = '3c03363f-1538-4464-aa6d-a5b458b7f8b0';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A slightly larger room on an upper floor, quieter than the street-facing standard rooms.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 22, "view": "Town or hill view", "smoking": "non_smoking", "roomAmenities": ["Hot shower", "Flat-screen TV", "Kettle with tea and coffee", "Extra blankets", "Writing desk", "Free Wi-Fi"]}'::jsonb
WHERE id = 'c21b50ff-2dcf-4394-a845-f491ae9f15aa';

-- photo 1 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Jalan_Besar,_Tanah_Rata,_Cameron_Highlands.jpg
-- photo 2 (similar hotel, Unsplash License): https://unsplash.com/photos/hotel-lobby-with-patterned-carpet-Cj7a21nHLyo
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/hotel-room-with-two-beds-cDRKleMCFrs
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/tea-plantations-in-green-mountains-c61jL_NpAn8
DELETE FROM public.media_assets WHERE outlet_id = 'd7f630a8-373a-5b44-d829-0d354e1cfd0d' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('fd5b8e50-4475-76f7-3240-7283c6ba31ef', 'd7f630a8-373a-5b44-d829-0d354e1cfd0d', 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Jalan_Besar%2C_Tanah_Rata%2C_Cameron_Highlands.jpg', 'image', -1, 'Jalan Besar, the main street of Tanah Rata, Cameron Highlands'),
  ('fd5b8e50-4475-76f7-3240-7283c6ba31ef', 'd7f630a8-373a-5b44-d829-0d354e1cfd0d', 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Jalan_Besar%2C_Tanah_Rata%2C_Cameron_Highlands.jpg', 'image', 0, 'Jalan Besar, the main street of Tanah Rata, Cameron Highlands'),
  ('fd5b8e50-4475-76f7-3240-7283c6ba31ef', 'd7f630a8-373a-5b44-d829-0d354e1cfd0d', 'https://images.unsplash.com/photo-1573052905904-34ad8c27f0cc?w=1280&q=80', 'image', 1, 'Classic hotel lobby with patterned carpet, armchairs and an arched doorway'),
  ('fd5b8e50-4475-76f7-3240-7283c6ba31ef', 'd7f630a8-373a-5b44-d829-0d354e1cfd0d', 'https://images.unsplash.com/photo-1790774877815-5358d88f4c52?w=1280&q=80', 'image', 2, 'Two beds with patterned beige bedspreads in a hotel room'),
  ('fd5b8e50-4475-76f7-3240-7283c6ba31ef', 'd7f630a8-373a-5b44-d829-0d354e1cfd0d', 'https://images.unsplash.com/photo-1470087167738-6aa485ff65dc?w=1280&q=80', 'image', 3, 'Rolling green tea plantations under a cloudy sky');

-- ===== Pullman Kuching =====
-- source (about): https://all.accor.com/hotel/6332/index.en.shtml
-- source (amenities): https://all.accor.com/hotel/6332/index.en.shtml
-- source (check-in/out): https://all.accor.com/hotel/6332/index.en.shtml
-- source (policies): https://all.accor.com/hotel/6332/index.en.shtml
-- note: Room mapping: Superior Room = official Deluxe Room (38 sqm, city view); Deluxe Room = Premium Deluxe Room (45 sqm, river view); Family Room = Family Room (51 sqm); Suite = Executive Suite (76 sqm). Accor notes ongoing renovations may close some areas. The cover photo shows the Kuching Waterfront view, not the hotel. The Nespresso machine in the suite is a demo guess.
UPDATE public.outlets
SET hotel_about = 'A five-star hotel in central Kuching overlooking the Sarawak River, linked to The Hills shopping mall and a short walk from the Waterfront, Main Bazaar and Borneo Cultural Museum. It has 389 rooms, a social pool with a bar, a gym, Culina all-day dining, Nu Er Hong Chinese restaurant, The Junction bar and a large pillarless ballroom.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'gym', 'restaurant', 'breakfast', 'front_desk_24h', 'airport_transfer', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and the hotel is 100% non-smoking. Family rooms sleep up to four; other rooms take a maximum of three guests. An airport shuttle is available on request for a fee, and a card deposit is held at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '65f4aa65-bebd-af91-bc18-234094bedcaf';

-- Deluxe Room -- source: https://all.accor.com/hotel/6332/index.en.shtml
UPDATE public.products
SET description = 'A Premium Deluxe room facing the Sarawak River, with a bathtub and separate rain shower.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 3, "sizeSqm": 45, "view": "Sarawak River view", "smoking": "non_smoking", "roomAmenities": ["Bathtub with separate rain shower", "Walk-in wardrobe", "Yoga mat and dumbbells", "Bathrobes", "Minibar (chargeable)", "Electronic safe", "Coffee and tea making", "Free Wi-Fi"]}'::jsonb
WHERE id = '22eb9268-b85f-d1d7-4bf5-d036e38ca41c';

-- Family Room -- source: https://all.accor.com/hotel/6332/index.en.shtml
UPDATE public.products
SET description = 'A family room with a king bed plus a single and floor-to-ceiling windows over the city.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 single bed", "maxGuests": 4, "sizeSqm": 51, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Floor-to-ceiling windows", "Bathtub with separate shower", "Bathrobes", "Minibar (chargeable)", "Electronic safe", "Coffee and tea making", "Free Wi-Fi"]}'::jsonb
WHERE id = '7f2dcabf-800d-4551-afd5-a42ddd7dfe78';

-- Suite -- source: https://all.accor.com/hotel/6332/index.en.shtml
UPDATE public.products
SET description = 'An Executive Suite with separate living and dining areas and access to The Peak Executive Lounge.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 76, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Separate living and dining area", "Executive lounge access", "Bathtub with separate rain shower", "Bathrobes and slippers", "Minibar (chargeable)", "Nespresso coffee machine", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '245bb1c1-d585-671d-062b-18d1fe431ef1';

-- Superior Room -- source: https://all.accor.com/hotel/6332/index.en.shtml
UPDATE public.products
SET description = 'The hotel''s entry-level Deluxe room, with a city view and a fitness kit in the room.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 3, "sizeSqm": 38, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Rain shower", "Yoga mat and dumbbells", "Work desk", "Minibar (chargeable)", "Electronic safe", "Coffee and tea making", "Free Wi-Fi"]}'::jsonb
WHERE id = '977d7101-748b-4f3b-a2d3-0303c3d38b52';

-- photo 1 (similar hotel, Unsplash License): https://unsplash.com/photos/ZCNNcxY7AAY
-- photo 2 (similar hotel, Unsplash License): https://unsplash.com/photos/serene-rooftop-pool-area-with-lounge-chairs-and-umbrellas-flDgsUUI3zQ
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/zSG-kd-L6vw
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/9QhyuOeu3Ik
DELETE FROM public.media_assets WHERE outlet_id = '65f4aa65-bebd-af91-bc18-234094bedcaf' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('15ef237b-b0a9-bab8-03d2-17950b92bbbe', '65f4aa65-bebd-af91-bc18-234094bedcaf', 'https://images.unsplash.com/photo-1762774365051-add54197be99?w=1280&q=80', 'image', -1, 'Sarawak State Assembly building across the river from Kuching Waterfront, with boats'),
  ('15ef237b-b0a9-bab8-03d2-17950b92bbbe', '65f4aa65-bebd-af91-bc18-234094bedcaf', 'https://images.unsplash.com/photo-1762774365051-add54197be99?w=1280&q=80', 'image', 0, 'Sarawak State Assembly building across the river from Kuching Waterfront, with boats'),
  ('15ef237b-b0a9-bab8-03d2-17950b92bbbe', '65f4aa65-bebd-af91-bc18-234094bedcaf', 'https://images.unsplash.com/photo-1783667711521-aaf123ca2f55?w=1280&q=80', 'image', 1, 'Rooftop hotel pool with sun loungers and umbrellas'),
  ('15ef237b-b0a9-bab8-03d2-17950b92bbbe', '65f4aa65-bebd-af91-bc18-234094bedcaf', 'https://images.unsplash.com/photo-1621293954908-907159247fc8?w=1280&q=80', 'image', 2, 'Modern hotel lobby lounge with timber walls and designer chairs'),
  ('15ef237b-b0a9-bab8-03d2-17950b92bbbe', '65f4aa65-bebd-af91-bc18-234094bedcaf', 'https://images.unsplash.com/photo-1778205015308-1ed324aea202?w=1280&q=80', 'image', 3, 'Contemporary bedroom with a marble feature wall and sheer curtains');

-- ===== Putra Regency Hotel =====
-- source (about): https://destinia.com/en/hotels/asia/malaysia/perlis/kangar/the-putra-regency/ho-388490
-- source (amenities): https://destinia.com/en/hotels/asia/malaysia/perlis/kangar/the-putra-regency/ho-388490
-- source (check-in/out): https://destinia.com/en/hotels/asia/malaysia/perlis/kangar/the-putra-regency/ho-388490
-- source (policies): invented for demo
-- note: No official website found; facts from Destinia/Expedia/Wotif listings. Also listed as Putra Palace Hotel Kangar (older name). Room count varies (107 vs 145). Check-in 15:00 per Destinia/Wotif (one listing says 14:00). Room details invented. Photos show Kangar and similar hotel facilities.
UPDATE public.outlets
SET hotel_about = 'A mid-range city hotel on Persiaran Jubli Emas, a few minutes from Kangar town centre, popular with business and government visitors to Perlis. It has more than 100 air-conditioned rooms, an outdoor pool, an a la carte restaurant and meeting rooms, and makes a convenient stop for trips to Padang Besar, Gua Kelam or the Kuala Perlis ferry to Langkawi.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'swimming_pool', 'restaurant', 'breakfast', 'front_desk_24h', 'free_parking']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all rooms are non-smoking. Children under 12 stay free using existing beds, and one extra bed per room can be added for a nightly charge. A refundable deposit is taken at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'd43ff12d-cc02-d36d-8031-b5cc6bafcfd1';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A more spacious room with a king or twin beds and a seating corner.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 3, "sizeSqm": 28, "view": "City or pool view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Bathtub and shower", "LCD TV", "Free Wi-Fi", "Coffee and tea making", "Work desk", "In-room safe", "Mini fridge"]}'::jsonb
WHERE id = 'c04f84a2-c6fb-e96b-4a59-3e3a462b889a';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with a king bed and two singles, close to the pool.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 4, "sizeSqm": 36, "view": "Pool view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Bathtub and shower", "LCD TV", "Free Wi-Fi", "Coffee and tea making", "In-room safe", "Mini fridge"]}'::jsonb
WHERE id = 'b8e41b28-11da-448f-af54-b1459defdc1a';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'A suite with a separate living room, a king bedroom and views across Kangar.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 48, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Separate living room", "Air-conditioning", "Bathtub and shower", "LCD TV", "Free Wi-Fi", "Coffee and tea making", "In-room safe", "Minibar"]}'::jsonb
WHERE id = '12c434c8-c44d-5aad-4cb0-baa252b6ba2a';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A practical room with queen or twin beds, a work desk and everything needed for a business stay.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air-conditioning", "Rain shower", "LCD TV", "Free Wi-Fi", "Coffee and tea making", "Work desk", "In-room safe"]}'::jsonb
WHERE id = '2218a27b-94ca-469e-a25e-19c793d32e8d';

-- photo 1 (similar hotel, CC BY 3.0): https://commons.wikimedia.org/wiki/File:Kangar_capital_of_perlis.jpg
-- photo 2 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Swimming_pool_of_Aloft_Kuala_Lumpur_Sentral,_Malaysia_-_20110726.jpg
-- photo 3 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Deluxe_Room_-_Twin_beds.jpg
-- photo 4 (similar hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Comfort_Twin_Room_in_Triple_Configuration_(21917602991).jpg
DELETE FROM public.media_assets WHERE outlet_id = 'd43ff12d-cc02-d36d-8031-b5cc6bafcfd1' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('6fee810d-9c18-23ba-224a-766cdadacbd2', 'd43ff12d-cc02-d36d-8031-b5cc6bafcfd1', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Kangar_capital_of_perlis.jpg/1280px-Kangar_capital_of_perlis.jpg', 'image', -1, 'Colourful buildings on a main road in Kangar, Perlis'),
  ('6fee810d-9c18-23ba-224a-766cdadacbd2', 'd43ff12d-cc02-d36d-8031-b5cc6bafcfd1', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Kangar_capital_of_perlis.jpg/1280px-Kangar_capital_of_perlis.jpg', 'image', 0, 'Colourful buildings on a main road in Kangar, Perlis'),
  ('6fee810d-9c18-23ba-224a-766cdadacbd2', 'd43ff12d-cc02-d36d-8031-b5cc6bafcfd1', 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Swimming_pool_of_Aloft_Kuala_Lumpur_Sentral%2C_Malaysia_-_20110726.jpg', 'image', 1, 'Hotel swimming pool surrounded by palms and sun loungers'),
  ('6fee810d-9c18-23ba-224a-766cdadacbd2', 'd43ff12d-cc02-d36d-8031-b5cc6bafcfd1', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Deluxe_Room_-_Twin_beds.jpg/1280px-Deluxe_Room_-_Twin_beds.jpg', 'image', 2, 'Deluxe hotel room with twin beds and a garden window'),
  ('6fee810d-9c18-23ba-224a-766cdadacbd2', 'd43ff12d-cc02-d36d-8031-b5cc6bafcfd1', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Comfort_Twin_Room_in_Triple_Configuration_%2821917602991%29.jpg/1280px-Comfort_Twin_Room_in_Triple_Configuration_%2821917602991%29.jpg', 'image', 3, 'Bright hotel room with three single beds for a family');

-- ===== Samila Hotel =====
-- source (about): https://www.successfulmeetings.com/Meeting-Event-Venues/Alor-Setar-Malaysia/Convention-Hotel/Hotel-Samila-p56223630
-- source (amenities): https://bookitbutton.booking.com/hotel/my/samila.en-gb.html
-- source (check-in/out): https://destinia.com/en/hotels/asia/malaysia/kedah/alor-setar/samila/ho-45857
-- source (policies): https://ms.hotels.com/en/ho629793504/
-- note: Listed as Hotel Samila (27 Jalan Kanchut / Lebuhraya Darulaman). No official website found. Room mapping: Deluxe = Premier King, Superior = Premier Twin, Family = Family Suite, Suite = Executive Suite; Standard invented. Sizes estimated.
UPDATE public.outlets
SET hotel_about = 'A long-running hotel in central Alor Setar, opened in the 1970s and a short walk from Aman Central mall. The four-storey building has around 50 non-smoking rooms, with free Wi-Fi, free private parking, a 24-hour front desk and luggage storage for travellers heading north to Perlis or Langkawi.',
    amenity_codes = ARRAY['wifi', 'free_parking', 'front_desk_24h', 'air_conditioning']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'All rooms are non-smoking and pets are not allowed. A cash or card deposit is needed for incidental charges, and photo ID may be requested at check-in. Extra beds are not available, but family suites suit groups of four.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '9b91593e-9f52-a0d6-77ab-003e0098d1fe';

-- Deluxe Room -- source: https://nz.trip.com/hotels/alor-setar-hotel-detail-22993310/samila
UPDATE public.products
SET description = 'A premier king room with updated furnishings and a work desk for business guests.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 2, "sizeSqm": 26, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Refrigerator", "Electric kettle", "Hairdryer", "Work desk", "Free Wi-Fi"]}'::jsonb
WHERE id = '76220c75-b583-4d6d-a64b-adf644b9d002';

-- Family Room -- source: https://nz.trip.com/hotels/alor-setar-hotel-detail-22993310/samila
UPDATE public.products
SET description = 'A family suite with space for four and a small lounge corner.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 4, "sizeSqm": 36, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Refrigerator", "Electric kettle", "Hairdryer", "Work desk", "Free Wi-Fi", "Sitting area"]}'::jsonb
WHERE id = 'd60d4681-87c2-85dc-cdef-625c5c8d9888';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A compact standard room with the basics for a short city stopover.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 18, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Refrigerator", "Electric kettle", "Hairdryer", "Work desk", "Free Wi-Fi"]}'::jsonb
WHERE id = '3f1ad67f-00af-cc53-e713-6c3d7b246c58';

-- Suite -- source: https://nz.trip.com/hotels/alor-setar-hotel-detail-22993310/samila
UPDATE public.products
SET description = 'The executive suite, with a separate living area and more room to work or relax.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 42, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Refrigerator", "Electric kettle", "Hairdryer", "Work desk", "Free Wi-Fi", "Separate living area"]}'::jsonb
WHERE id = '52758818-e74d-4524-ac87-b89d1e0b3843';

-- Superior Room -- source: https://nz.trip.com/hotels/alor-setar-hotel-detail-22993310/samila
UPDATE public.products
SET description = 'A premier twin room with two beds, good for friends or colleagues.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "Refrigerator", "Electric kettle", "Hairdryer", "Work desk", "Free Wi-Fi"]}'::jsonb
WHERE id = '4080895b-26bf-4eea-aea9-c14c4353a3fe';

-- photo 1 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Samila_Hotel.jpg
-- photo 2 (similar hotel, CC BY-SA 2.0): https://commons.wikimedia.org/wiki/File:Alor_Setar_Downtown_Panoramio_(29056786341).jpg
-- photo 3 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Bed_in_hotel_room_3.jpg
-- photo 4 (similar hotel, CC BY-SA 2.0): https://commons.wikimedia.org/wiki/File:Hotel_Royal_@_Queens_room,_Singapore_(4448415354).jpg
DELETE FROM public.media_assets WHERE outlet_id = '9b91593e-9f52-a0d6-77ab-003e0098d1fe' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('f4cce147-62e7-534f-e6ff-45e1b47f8df6', '9b91593e-9f52-a0d6-77ab-003e0098d1fe', 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Samila_Hotel.jpg/1280px-Samila_Hotel.jpg', 'image', -1, 'Exterior of Samila Hotel on a main road in Alor Setar'),
  ('f4cce147-62e7-534f-e6ff-45e1b47f8df6', '9b91593e-9f52-a0d6-77ab-003e0098d1fe', 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Samila_Hotel.jpg/1280px-Samila_Hotel.jpg', 'image', 0, 'Exterior of Samila Hotel on a main road in Alor Setar'),
  ('f4cce147-62e7-534f-e6ff-45e1b47f8df6', '9b91593e-9f52-a0d6-77ab-003e0098d1fe', 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Alor_Setar_Downtown_Panoramio_%2829056786341%29.jpg/1280px-Alor_Setar_Downtown_Panoramio_%2829056786341%29.jpg', 'image', 1, 'Panorama of Alor Setar city square'),
  ('f4cce147-62e7-534f-e6ff-45e1b47f8df6', '9b91593e-9f52-a0d6-77ab-003e0098d1fe', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Bed_in_hotel_room_3.jpg/1280px-Bed_in_hotel_room_3.jpg', 'image', 2, 'Hotel room with two double beds and bedside lamps'),
  ('f4cce147-62e7-534f-e6ff-45e1b47f8df6', '9b91593e-9f52-a0d6-77ab-003e0098d1fe', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Hotel_Royal_%40_Queens_room%2C_Singapore_%284448415354%29.jpg/1280px-Hotel_Royal_%40_Queens_room%2C_Singapore_%284448415354%29.jpg', 'image', 3, 'Hotel room with a double bed, desk and city-view window');

-- ===== Sandy Beach Resort =====
-- source (about): https://ca.hotels.com/ho436445/sandy-beach-resort-langkawi-langkawi-malaysia
-- source (amenities): https://ca.hotels.com/ho436445/sandy-beach-resort-langkawi-langkawi-malaysia
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: No working official website (sandybeachresortlangkawi.com is a parked domain). Now listed as 'Sandy Beach Resort by Casa Loma'. Mapping: Family Room = Family Apartment (sea view, sleeps 4); Suite = Family Chalet Suite. Sizes for Deluxe and Suite are guesses. No Commons photos of the resort exist.
UPDATE public.outlets
SET hotel_about = 'One of Langkawi''s earliest beach hotels, set right in the middle of Pantai Cenang with rooms split between a beachside section and a garden section across the road. It is a simple, good-value choice close to the restaurants and nightlife of Cenang, with a seafood grill restaurant, a coffee shop, barbecue areas and free Wi-Fi.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'restaurant', 'free_parking']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and smoking is only permitted outdoors. Children under 6 stay free using existing beds, and extra mattresses are available for a small fee. A ferry terminal shuttle can be arranged for a surcharge.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'dba71d75-faf6-ff99-25e2-86628bc723d2';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A roomier beachside room with a king bed and a small terrace for sunset watching.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 24, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Air conditioning", "Private terrace", "TV", "Kettle", "Mini fridge", "Free Wi-Fi"]}'::jsonb
WHERE id = '6eeef62d-66d9-d6d9-e741-57fd64bc880f';

-- Family Room -- source: https://ca.hotels.com/ho436445/sandy-beach-resort-langkawi-langkawi-malaysia
UPDATE public.products
SET description = 'A sea-view family apartment with space for four, steps from Cenang beach.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 35, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Air conditioning", "Sitting area", "TV", "Kettle", "Mini fridge", "Free Wi-Fi"]}'::jsonb
WHERE id = '77e5dcd4-1050-4445-acb2-48707e282f1c';

-- Standard Room -- source: https://ca.hotels.com/ho436445/sandy-beach-resort-langkawi-langkawi-malaysia
UPDATE public.products
SET description = 'A small, simple garden-side room with air conditioning, a short walk from the beach.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 15, "view": "Garden view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Air conditioning", "TV", "Kettle", "Free Wi-Fi"]}'::jsonb
WHERE id = 'e780ac3f-c141-5e94-9e45-c701ba831bc0';

-- Suite -- source: https://www.trip.com/t/i8zopme36R2
UPDATE public.products
SET description = 'A two-room chalet suite with a living area and verandah, the most spacious option at the resort.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 4, "sizeSqm": 42, "view": "Garden and partial sea view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Air conditioning", "Living area", "Verandah", "TV", "Kettle", "Mini fridge", "Free Wi-Fi"]}'::jsonb
WHERE id = '7d703393-2879-4777-a90f-6e66fb5e18a0';

-- Superior Room -- source: https://ca.hotels.com/ho436445/sandy-beach-resort-langkawi-langkawi-malaysia
UPDATE public.products
SET description = 'A room on the beachside section of the resort, about 50 metres from the water.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 20, "view": "Partial sea view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Air conditioning", "TV", "Kettle", "Mini fridge", "Free Wi-Fi"]}'::jsonb
WHERE id = 'b71a8794-6f16-4137-a9f0-3c4d54ed1268';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Pantai_Cenang,_Langkawi_01.jpg
-- photo 2 (similar hotel, Unsplash License): https://unsplash.com/photos/brown-wooden-house-on-white-sand-under-white-clouds-during-daytime-BR1ixF95cGs
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/twin-beds-in-a-bright-room-with-a-sea-view-uXYHodDhiG4
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/wooden-table-and-chair-near-house-at-the-beach-SlB_ti2lWeA
DELETE FROM public.media_assets WHERE outlet_id = 'dba71d75-faf6-ff99-25e2-86628bc723d2' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('9d4330e5-aa5a-cd65-49f3-039a51f46095', 'dba71d75-faf6-ff99-25e2-86628bc723d2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Pantai_Cenang%2C_Langkawi_01.jpg/1280px-Pantai_Cenang%2C_Langkawi_01.jpg', 'image', -1, 'White sand and calm sea at Pantai Cenang, Langkawi'),
  ('9d4330e5-aa5a-cd65-49f3-039a51f46095', 'dba71d75-faf6-ff99-25e2-86628bc723d2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Pantai_Cenang%2C_Langkawi_01.jpg/1280px-Pantai_Cenang%2C_Langkawi_01.jpg', 'image', 0, 'White sand and calm sea at Pantai Cenang, Langkawi'),
  ('9d4330e5-aa5a-cd65-49f3-039a51f46095', 'dba71d75-faf6-ff99-25e2-86628bc723d2', 'https://images.unsplash.com/photo-1625224588813-cc8d5055493f?w=1280&q=80', 'image', 1, 'Wooden beach chalet on white sand'),
  ('9d4330e5-aa5a-cd65-49f3-039a51f46095', 'dba71d75-faf6-ff99-25e2-86628bc723d2', 'https://images.unsplash.com/photo-1779870458288-95fd59cd2c5b?w=1280&q=80', 'image', 2, 'Twin beds in a bright room with a sea view'),
  ('9d4330e5-aa5a-cd65-49f3-039a51f46095', 'dba71d75-faf6-ff99-25e2-86628bc723d2', 'https://images.unsplash.com/photo-1565065590167-59f260459e86?w=1280&q=80', 'image', 3, 'Wooden table and chairs outside a beach house');

-- ===== Shangri La's Tanjung Aru Resort & Spa =====
-- source (about): https://www.shangri-la.com/kotakinabalu/tanjungaruresort/
-- source (amenities): https://www.shangri-la.com/kotakinabalu/tanjungaruresort/
-- source (check-in/out): https://www.shangri-la.com/kotakinabalu/tanjungaruresort/
-- source (policies): invented for demo
-- note: The resort has no 'Garden Wing'. Room mapping: Garden Wing Room = Kinabalu Wing Seaview Terrace Room (ground floor with garden patio); Superior Room = Kinabalu Wing Mountain View Room; Deluxe Room = Tanjung Wing Pool View; Sea View Room = Tanjung Wing Seaview Room; Family Room = Questers Tanjung Family Terrace Room. Bed types and occupancy are not listed on the official pages and are estimates.
UPDATE public.outlets
SET hotel_about = 'A five-star beachfront resort on the Tanjung Aru peninsula, about 10 minutes from Kota Kinabalu airport and famous for its sunsets over the South China Sea. Its 492 rooms are split between the Kinabalu and Tanjung wings, and guests can use several pools, a private beach, CHI The Spa, a kids'' club, a marina with boats to the nearby islands, and restaurants and bars.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'gym', 'restaurant', 'breakfast', 'front_desk_24h', 'laundry', 'airport_transfer', 'accessible']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all rooms are non-smoking. Children sharing their parents'' room with existing bedding stay free; an extra bed is available for a nightly charge, except in Family Terrace Rooms. A credit card guarantee is required at check-in.',
    wheelchair_accessible = true,
    pet_friendly = false
WHERE id = 'fe02653b-6755-b6fc-196a-d5ea00dd8ab3';

-- Deluxe Room -- source: https://www.shangri-la.com/kotakinabalu/tanjungaruresort/rooms-suites/
UPDATE public.products
SET description = 'A Tanjung Wing room with a balcony overlooking the resort''s main pools and gardens.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 47, "view": "Pool view from a private balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "Bathtub and separate shower", "Bathrobes and slippers", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi", "24-hour in-room dining"]}'::jsonb
WHERE id = 'fd6ef5e2-7fcd-45b6-ab7d-ecd1972a2992';

-- Family Room -- source: https://www.shangri-la.com/kotakinabalu/tanjungaruresort/rooms-suites/
UPDATE public.products
SET description = 'A themed family room with a terrace and a kids'' sleeping area, close to the pools.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 4, "sizeSqm": 53, "view": "Pool view from a private terrace", "smoking": "non_smoking", "roomAmenities": ["Private terrace", "Children''s bunk or sleeping area", "Kids'' amenity kit", "Bathtub and separate shower", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '010a0cd5-a034-4859-a9a4-288e4fe938f2';

-- Garden Wing Room -- source: https://www.shangri-la.com/kotakinabalu/tanjungaruresort/rooms-suites/rooms/kinabalu-wing/kinabalu-sea-view-terrace-room
UPDATE public.products
SET description = 'A ground-floor Kinabalu Wing room whose patio door opens onto a private garden space.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 45, "view": "Garden and sea view from a ground-floor terrace", "smoking": "non_smoking", "roomAmenities": ["Private garden terrace", "Bathtub and separate shower", "Bathrobes and slippers", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi", "24-hour in-room dining"]}'::jsonb
WHERE id = 'd7241fdd-2e42-9140-70af-de186d6e16a4';

-- Sea View Room -- source: https://www.shangri-la.com/kotakinabalu/tanjungaruresort/rooms-suites/
UPDATE public.products
SET description = 'A Tanjung Wing room with a balcony facing the South China Sea and the sunset.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 47, "view": "South China Sea view from a private balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "Bathtub and separate shower", "Bathrobes and slippers", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi", "24-hour in-room dining"]}'::jsonb
WHERE id = 'c80bff04-1ee7-bf5f-6dcb-a0f050b9586a';

-- Superior Room -- source: https://www.shangri-la.com/kotakinabalu/tanjungaruresort/rooms-suites/
UPDATE public.products
SET description = 'A Kinabalu Wing room with a balcony looking towards Mount Kinabalu across the gardens.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 45, "view": "Mount Kinabalu and garden view", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "Bathtub and separate shower", "Bathrobes and slippers", "Coffee and tea making", "Minibar (chargeable)", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = 'ff338d18-f4cb-4b5a-acce-b7b273b61dd2';

-- photo 1 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Shangri-La_Tanjung_Aru_01.jpg
-- photo 2 (this hotel, CC0): https://commons.wikimedia.org/wiki/File:Swimming_pool,_Shangri-La_Tanjung_Aru.jpg
-- photo 3 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Shangri-La_Tanjung_Aru_04.jpg
-- photo 4 (this hotel, CC0): https://commons.wikimedia.org/wiki/File:Private_Beach_in_Shangri-La_Tanjung_Aru.jpg
DELETE FROM public.media_assets WHERE outlet_id = 'fe02653b-6755-b6fc-196a-d5ea00dd8ab3' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('9a2a8992-f631-b400-7679-90643e67fef6', 'fe02653b-6755-b6fc-196a-d5ea00dd8ab3', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Shangri-La_Tanjung_Aru_01.jpg/1280px-Shangri-La_Tanjung_Aru_01.jpg', 'image', -1, 'Resort wing and palm-filled gardens beside the sea under an orange sunset sky'),
  ('9a2a8992-f631-b400-7679-90643e67fef6', 'fe02653b-6755-b6fc-196a-d5ea00dd8ab3', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Shangri-La_Tanjung_Aru_01.jpg/1280px-Shangri-La_Tanjung_Aru_01.jpg', 'image', 0, 'Resort wing and palm-filled gardens beside the sea under an orange sunset sky'),
  ('9a2a8992-f631-b400-7679-90643e67fef6', 'fe02653b-6755-b6fc-196a-d5ea00dd8ab3', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Swimming_pool%2C_Shangri-La_Tanjung_Aru.jpg/1280px-Swimming_pool%2C_Shangri-La_Tanjung_Aru.jpg', 'image', 1, 'Large free-form swimming pool surrounded by palms and sun umbrellas'),
  ('9a2a8992-f631-b400-7679-90643e67fef6', 'fe02653b-6755-b6fc-196a-d5ea00dd8ab3', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Shangri-La_Tanjung_Aru_04.jpg/1280px-Shangri-La_Tanjung_Aru_04.jpg', 'image', 2, 'Lamp-lit seaside walkway leading to a pavilion at dusk'),
  ('9a2a8992-f631-b400-7679-90643e67fef6', 'fe02653b-6755-b6fc-196a-d5ea00dd8ab3', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Private_Beach_in_Shangri-La_Tanjung_Aru.jpg/1280px-Private_Beach_in_Shangri-La_Tanjung_Aru.jpg', 'image', 3, 'Private sandy beach with loungers and green umbrellas facing the sea');

-- ===== Shangri-La Rasa Sayang Resort & Spa =====
-- source (about): https://www.shangri-la.com/penang/rasasayangresort/
-- source (amenities): https://www.shangri-la.com/penang/rasasayangresort/
-- source (check-in/out): https://www.shangri-la.com/penang/rasasayangresort/
-- source (policies): https://www.shangri-la.com/penang/rasasayangresort/
-- note: Room mapping (no renames): Superior Room = Rasa Wing Rasa Superior (40 sqm); Deluxe Room = Garden Wing Deluxe Garden View (size assumed same as Seaview, 42 sqm); Garden Wing Deluxe Sea View = Deluxe Seaview (42 sqm); Rasa Wing Premier Room = Rasa Wing Rasa Deluxe (44 sqm, private garden/pool access), not the 119 sqm Premier Suite; Family Room = Garden Wing Deluxe Family (60 sqm). Bed types and occupancy invented. Pet/smoking/extra-bed policy invented; Rasa Wing pool 16+ is official.
UPDATE public.outlets
SET hotel_about = 'A beachfront resort on Batu Ferringhi, Penang, with 304 rooms and suites in two wings: the family-friendly Garden Wing and the more exclusive Rasa Wing, set among century-old rain trees. Facilities include several pools (one adults-only for Rasa Wing guests), CHI The Spa, a health club, a kids club and restaurants such as Feringgi Grill and Spice Market Cafe.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'swimming_pool', 'restaurant', 'breakfast', 'gym', 'front_desk_24h', 'laundry', 'airport_transfer']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and smoking is not permitted indoors. The Rasa Wing pool is for guests aged 16 and over, while younger guests can use the Adventure Zone kids club. Extra beds and baby cots can be added to most rooms on request for a nightly fee.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '4b2d6abb-092d-be78-6aec-a3c8344b05b5';

-- Deluxe Room -- source: https://www.shangri-la.com/penang/rasasayangresort/rooms-suites/
UPDATE public.products
SET description = 'A Garden Wing room with a private balcony overlooking the resort''s tropical gardens.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 42, "view": "Garden view from a private balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "Bathtub and separate shower", "Coffee and tea making", "Minibar", "In-room safe", "Free Wi-Fi", "24-hour in-room dining"]}'::jsonb
WHERE id = '95c51317-8a07-4bca-ab85-a375113b021e';

-- Family Room -- source: https://www.shangri-la.com/penang/rasasayangresort/rooms-suites/
UPDATE public.products
SET description = 'A spacious Garden Wing family room with a balcony over the landscaped grounds, near the kids club.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 4, "sizeSqm": 60, "view": "Landscaped garden view from a private balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "Bathtub and separate shower", "Coffee and tea making", "Minibar", "In-room safe", "Free Wi-Fi", "Kids club access"]}'::jsonb
WHERE id = '08f53727-2c4d-4e8c-a3c5-063d9c3af1f7';

-- Garden Wing Deluxe Sea View -- source: https://www.shangri-la.com/penang/rasasayangresort/rooms-suites/
UPDATE public.products
SET description = 'A Garden Wing room with a private balcony facing the Andaman Sea and Batu Ferringhi beach.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 42, "view": "Andaman Sea view from a private balcony", "smoking": "non_smoking", "roomAmenities": ["Private balcony", "Bathtub and separate shower", "Coffee and tea making", "Minibar", "In-room safe", "Free Wi-Fi", "24-hour in-room dining"]}'::jsonb
WHERE id = 'a16ecf9c-fa55-ec68-1d44-344613e34605';

-- Rasa Wing Premier Room -- source: https://www.shangri-la.com/penang/rasasayangresort/rooms-suites/
UPDATE public.products
SET description = 'A Rasa Wing room with direct access to the gardens and the adults-only Rasa Wing pool.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 2, "sizeSqm": 44, "view": "Garden and pool access", "smoking": "non_smoking", "roomAmenities": ["Direct garden and pool access", "Rasa Lounge afternoon tea", "Bathtub and separate shower", "Coffee and tea making", "Minibar", "In-room safe", "Free Wi-Fi", "24-hour in-room dining"]}'::jsonb
WHERE id = '4202dd85-9a4e-1815-6f72-2634ab97d2e6';

-- Superior Room -- source: https://www.shangri-la.com/penang/rasasayangresort/rooms-suites/
UPDATE public.products
SET description = 'A Rasa Wing room with Malay-inspired decor, looking out over the resort''s old rain trees.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 2, "sizeSqm": 40, "view": "Rain trees and courtyard", "smoking": "non_smoking", "roomAmenities": ["Bathtub and separate shower", "Rasa Lounge afternoon tea", "Coffee and tea making", "Minibar", "In-room safe", "Free Wi-Fi", "24-hour in-room dining"]}'::jsonb
WHERE id = 'e574d279-6512-4b8e-a8f6-811928fe567a';

-- photo 1 (this hotel, CC BY-SA 2.0): https://commons.wikimedia.org/wiki/File:Batu_Feringghi,_Penang.jpg
-- photo 2 (this hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Malaysia_-_067_-_Penang_-_Rasa_Sayang_Resorts_fantastic_grounds_(3922991958).jpg
-- photo 3 (this hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Malaysia_-_068_-_Penang_-_Rasa_Sayang_Resorts_fantastic_grounds_(3922994120).jpg
-- photo 4 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Batu_Ferringhi_beach_(221002)_01.jpg
DELETE FROM public.media_assets WHERE outlet_id = '4b2d6abb-092d-be78-6aec-a3c8344b05b5' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('fd6502d5-e2f6-eb93-e9db-8f3f968b29be', '4b2d6abb-092d-be78-6aec-a3c8344b05b5', 'https://upload.wikimedia.org/wikipedia/commons/9/9d/Batu_Feringghi%2C_Penang.jpg', 'image', -1, 'Aerial view of Rasa Sayang Resort beside the sea at Batu Ferringhi'),
  ('fd6502d5-e2f6-eb93-e9db-8f3f968b29be', '4b2d6abb-092d-be78-6aec-a3c8344b05b5', 'https://upload.wikimedia.org/wikipedia/commons/9/9d/Batu_Feringghi%2C_Penang.jpg', 'image', 0, 'Aerial view of Rasa Sayang Resort beside the sea at Batu Ferringhi'),
  ('fd6502d5-e2f6-eb93-e9db-8f3f968b29be', '4b2d6abb-092d-be78-6aec-a3c8344b05b5', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Malaysia_-_067_-_Penang_-_Rasa_Sayang_Resorts_fantastic_grounds_%283922991958%29.jpg/1280px-Malaysia_-_067_-_Penang_-_Rasa_Sayang_Resorts_fantastic_grounds_%283922991958%29.jpg', 'image', 1, 'Rasa Sayang Resort wings with Malay-style roofs above tropical gardens'),
  ('fd6502d5-e2f6-eb93-e9db-8f3f968b29be', '4b2d6abb-092d-be78-6aec-a3c8344b05b5', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Malaysia_-_068_-_Penang_-_Rasa_Sayang_Resorts_fantastic_grounds_%283922994120%29.jpg/1280px-Malaysia_-_068_-_Penang_-_Rasa_Sayang_Resorts_fantastic_grounds_%283922994120%29.jpg', 'image', 2, 'Palm-shaded lawns of Rasa Sayang Resort leading to the beach'),
  ('fd6502d5-e2f6-eb93-e9db-8f3f968b29be', '4b2d6abb-092d-be78-6aec-a3c8344b05b5', 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Batu_Ferringhi_beach_%28221002%29_01.jpg/1280px-Batu_Ferringhi_beach_%28221002%29_01.jpg', 'image', 3, 'Calm sea and sandy shore at Batu Ferringhi beach');

-- ===== The Jesselton Hotel =====
-- source (about): https://en.wikipedia.org/wiki/Jesselton_Hotel
-- source (amenities): https://www.amazingborneo.com/package/the-jesselton-hotel
-- source (check-in/out): https://www.amazingborneo.com/package/the-jesselton-hotel
-- source (policies): https://www.amazingborneo.com/package/the-jesselton-hotel
-- note: Room mapping: Deluxe = Deluxe King, Family = Deluxe Twin With Balcony (no dedicated family room), Standard = Boutique Queen, Suite = Junior Suite, Superior = Superior Queen. Boutique Queen size estimated.
UPDATE public.outlets
SET hotel_about = 'Kota Kinabalu''s oldest hotel, opened in 1954 on Gaya Street in the heart of the city and a short walk from Jesselton Point ferry terminal. This 32-room boutique property mixes colonial character with modern comforts, and its ground-floor Kudos restaurant serves European cuisine and a long list of wines.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'front_desk_24h', 'laundry', 'air_conditioning']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'All rooms are non-smoking and pets are not allowed. Children are welcome: Deluxe rooms and suites take 2 adults and 2 children, and connecting Superior rooms are available for families. An iron and ironing board are available on request.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'b6969593-a95e-a109-7a33-079e4f8ddde6';

-- Deluxe Room -- source: https://www.amazingborneo.com/package/the-jesselton-hotel
UPDATE public.products
SET description = 'A deluxe king room with a marble bathroom, suited to couples on longer city stays.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 4, "sizeSqm": 30, "view": "Gaya Street or city view", "smoking": "non_smoking", "roomAmenities": ["Flat-screen TV with cable channels", "Marble en-suite bathroom", "Bathrobes and sarongs", "In-room safe", "Coffee and tea making", "Mini fridge", "Free Wi-Fi"]}'::jsonb
WHERE id = 'e3f94382-df7f-d0e0-3e8b-bcc542914504';

-- Family Room -- source: https://www.jesseltonhotel.com
UPDATE public.products
SET description = 'A deluxe twin with a balcony over Gaya Street, sleeping 2 adults and 2 children.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 4, "sizeSqm": 30, "view": "Gaya Street view from a balcony", "smoking": "non_smoking", "roomAmenities": ["Flat-screen TV with cable channels", "Marble en-suite bathroom", "Bathrobes and sarongs", "In-room safe", "Coffee and tea making", "Mini fridge", "Free Wi-Fi", "Balcony"]}'::jsonb
WHERE id = 'ccc42ae2-f94f-470d-a2bf-920b93eb06ad';

-- Standard Room -- source: https://www.jesseltonhotel.com
UPDATE public.products
SET description = 'A cosy boutique queen room for couples or solo travellers on short stays.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 20, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Flat-screen TV with cable channels", "Marble en-suite bathroom", "Bathrobes and sarongs", "In-room safe", "Coffee and tea making", "Mini fridge", "Free Wi-Fi"]}'::jsonb
WHERE id = '9b010f37-55db-de7e-8a24-b20cc084d95e';

-- Suite -- source: https://www.amazingborneo.com/package/the-jesselton-hotel
UPDATE public.products
SET description = 'The junior suite, the hotel''s largest room type, with extra living space and a king bed.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 4, "sizeSqm": 40, "view": "Gaya Street view", "smoking": "non_smoking", "roomAmenities": ["Flat-screen TV with cable channels", "Marble en-suite bathroom", "Bathrobes and sarongs", "In-room safe", "Coffee and tea making", "Mini fridge", "Free Wi-Fi", "Sitting area"]}'::jsonb
WHERE id = '5ee78b52-e517-48ee-aa31-1239b7b73a09';

-- Superior Room -- source: https://www.amazingborneo.com/package/the-jesselton-hotel
UPDATE public.products
SET description = 'A superior queen room on Gaya Street, with connecting rooms available on request.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 3, "sizeSqm": 23, "view": "Gaya Street or city view", "smoking": "non_smoking", "roomAmenities": ["Flat-screen TV with cable channels", "Marble en-suite bathroom", "Bathrobes and sarongs", "In-room safe", "Coffee and tea making", "Mini fridge", "Free Wi-Fi"]}'::jsonb
WHERE id = '79dd4b14-8b7b-480c-af00-4857682aeafa';

-- photo 1 (this hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Kota_Kinabalu_Jesselton_Hotel_9770.jpg
-- photo 2 (this hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Kota_Kinabalu_Jesselton_Hotel_4683.jpg
-- photo 3 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Sunday_Morning_Market_in_Gaya_Street,_Kota_Kinabalu.jpg
-- photo 4 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Twin_guest_room_Hilton_Kota_Kinabalu_20251207_182012.jpg
DELETE FROM public.media_assets WHERE outlet_id = 'b6969593-a95e-a109-7a33-079e4f8ddde6' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('43b6d347-b2b7-c651-f749-1daa389d1fbd', 'b6969593-a95e-a109-7a33-079e4f8ddde6', 'https://upload.wikimedia.org/wikipedia/commons/3/3d/Kota_Kinabalu_Jesselton_Hotel_9770.jpg', 'image', -1, 'White colonial facade of The Jesselton Hotel on Gaya Street'),
  ('43b6d347-b2b7-c651-f749-1daa389d1fbd', 'b6969593-a95e-a109-7a33-079e4f8ddde6', 'https://upload.wikimedia.org/wikipedia/commons/3/3d/Kota_Kinabalu_Jesselton_Hotel_9770.jpg', 'image', 0, 'White colonial facade of The Jesselton Hotel on Gaya Street'),
  ('43b6d347-b2b7-c651-f749-1daa389d1fbd', 'b6969593-a95e-a109-7a33-079e4f8ddde6', 'https://upload.wikimedia.org/wikipedia/commons/d/de/Kota_Kinabalu_Jesselton_Hotel_4683.jpg', 'image', 1, 'The Jesselton Hotel lit up at night on Gaya Street'),
  ('43b6d347-b2b7-c651-f749-1daa389d1fbd', 'b6969593-a95e-a109-7a33-079e4f8ddde6', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Sunday_Morning_Market_in_Gaya_Street%2C_Kota_Kinabalu.jpg/1280px-Sunday_Morning_Market_in_Gaya_Street%2C_Kota_Kinabalu.jpg', 'image', 2, 'Sunday street market stalls on Gaya Street, Kota Kinabalu'),
  ('43b6d347-b2b7-c651-f749-1daa389d1fbd', 'b6969593-a95e-a109-7a33-079e4f8ddde6', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Twin_guest_room_Hilton_Kota_Kinabalu_20251207_182012.jpg/1280px-Twin_guest_room_Hilton_Kota_Kinabalu_20251207_182012.jpg', 'image', 3, 'Twin guest room with two beds in a Kota Kinabalu hotel');

-- ===== The LimeTree Hotel =====
-- source (about): https://www.agoda.com/en-au/the-limetree-hotel/hotel/kuching-my.html
-- source (amenities): https://www.agoda.com/en-au/the-limetree-hotel/hotel/kuching-my.html
-- source (check-in/out): https://www.expedia.com/Kuching-Hoteles-The-LimeTree-Hotel.h4012605.Informacion-Hotel
-- source (policies): https://www.expedia.com/Kuching-Hoteles-The-LimeTree-Hotel.h4012605.Informacion-Hotel
-- note: Official domain limetreehotel.com.my only redirects to a booking engine; facts taken from Agoda/Expedia listings. Real room types found: Standard City View (19 sqm) and Executive Deluxe City View (32 sqm); Superior, Family and Suite are invented to fit. No pool or gym. No Commons photos of the hotel exist.
UPDATE public.outlets
SET hotel_about = 'A lime-themed boutique hotel with about 50 rooms on five floors in central Kuching, a few minutes on foot from the Kuching Waterfront and the city''s food streets. Café Sublime serves local dishes from breakfast to dinner, and the LimeLight rooftop lounge pours lime cocktails with views towards the Sarawak River.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'air_conditioning', 'laundry']::text[],
    check_in_time = '14:00',
    check_out_time = '12:00',
    stay_policies = 'The main guest must be at least 21 to check in. Pets are not allowed and all rooms are non-smoking. Children under 6 stay free using existing beds; extra beds are available in Deluxe rooms and above for a fee.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'f80886d5-6d6e-e8bb-d8b0-54bb225a49a9';

-- Deluxe Room -- source: https://www.agoda.com/en-au/the-limetree-hotel/hotel/kuching-my.html
UPDATE public.products
SET description = 'A roomy executive deluxe room with a king bed, seating area and city outlook.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 32, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Rain shower", "Seating area", "Flat-screen TV", "Kettle with tea and coffee", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '9f70fbcf-6873-e50e-5c21-04860b423573';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with a queen bed and two singles, a short walk from the waterfront.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 36, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Rain shower", "Flat-screen TV", "Kettle with tea and coffee", "Mini fridge", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '956a87d8-1272-48f8-a609-f76f1e5923de';

-- Standard Room -- source: https://www.agoda.com/en-au/the-limetree-hotel/hotel/kuching-my.html
UPDATE public.products
SET description = 'A compact city-view room with lime-green accents, ideal for solo travellers or couples.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 19, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Rain shower", "Flat-screen TV", "Kettle with tea and coffee", "Work desk", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '130e1eec-f3a6-dfb6-b867-ecb397514234';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'The hotel''s largest room, with a separate lounge area and bathtub on an upper floor.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 45, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Separate lounge area", "Bathtub and shower", "Two flat-screen TVs", "Kettle with tea and coffee", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '858119d3-0835-40d1-a03c-186c1877923e';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A slightly larger room with a choice of queen or twin beds and a small work corner.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 24, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Rain shower", "Flat-screen TV", "Kettle with tea and coffee", "Work desk", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = 'd5f5baab-85eb-4e12-ac44-575544578283';

-- photo 1 (similar hotel, Unsplash License): https://unsplash.com/photos/a-row-of-multicolored-buildings-in-a-city-BjYpcBj5zcQ
-- photo 2 (similar hotel, CC BY-SA 2.0): https://commons.wikimedia.org/wiki/File:Kuching_Waterfront_at_night_(15834807985).jpg
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/white-bed-with-gray-pillow-p3UWyaujtQo
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/modern-hotel-lobby-with-designer-furniture-and-wood-walls-zSG-kd-L6vw
DELETE FROM public.media_assets WHERE outlet_id = 'f80886d5-6d6e-e8bb-d8b0-54bb225a49a9' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('6ac6819c-ce7a-4192-6364-b0a38e7a7ecf', 'f80886d5-6d6e-e8bb-d8b0-54bb225a49a9', 'https://images.unsplash.com/photo-1717118668739-1069b963f74f?w=1280&q=80', 'image', -1, 'Row of colourful shophouses in a Malaysian city'),
  ('6ac6819c-ce7a-4192-6364-b0a38e7a7ecf', 'f80886d5-6d6e-e8bb-d8b0-54bb225a49a9', 'https://images.unsplash.com/photo-1717118668739-1069b963f74f?w=1280&q=80', 'image', 0, 'Row of colourful shophouses in a Malaysian city'),
  ('6ac6819c-ce7a-4192-6364-b0a38e7a7ecf', 'f80886d5-6d6e-e8bb-d8b0-54bb225a49a9', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Kuching_Waterfront_at_night_%2815834807985%29.jpg/1280px-Kuching_Waterfront_at_night_%2815834807985%29.jpg', 'image', 1, 'Hotels and riverside buildings along the Kuching Waterfront at night'),
  ('6ac6819c-ce7a-4192-6364-b0a38e7a7ecf', 'f80886d5-6d6e-e8bb-d8b0-54bb225a49a9', 'https://images.unsplash.com/photo-1629140727571-9b5c6f6267b4?w=1280&q=80', 'image', 2, 'White hotel bed with grey pillows'),
  ('6ac6819c-ce7a-4192-6364-b0a38e7a7ecf', 'f80886d5-6d6e-e8bb-d8b0-54bb225a49a9', 'https://images.unsplash.com/photo-1621293954908-907159247fc8?w=1280&q=80', 'image', 3, 'Modern boutique hotel lobby with designer furniture and wood walls');

-- ===== The Majestic Station Hotel =====
-- source (about): https://thestar.com.my/news/nation/2020/01/31/reviving-ipoh-hotels-majestic-days
-- source (amenities): invented for demo
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: CLOSED: the hotel stopped operating around 2010-2011. In 2020 a redevelopment as 'Grand Majestic Hotel' was announced for 2023, but no reopening could be confirmed, and 2024 Commons photos show the interiors still dilapidated. All operational details (amenities, times, policies, rooms) are invented for the demo. The building history (1917 station) is real.
UPDATE public.outlets
SET hotel_about = 'A colonial-era hotel on the upper floor of Ipoh''s grand white railway station, built in 1917 in a mix of Moorish and Edwardian styles. Guests reach their rooms along a long, breezy verandah that looks over the station gardens towards Ipoh old town, and the verandah cafe serves local breakfasts and afternoon tea.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'laundry']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and the historic building is entirely non-smoking. One extra bed can be added to Deluxe rooms and suites for a nightly fee, and children under 6 stay free using existing bedding. A cash or card deposit is taken at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '03050469-be2d-c9a8-dc02-4a335da1f9ca';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A high-ceilinged colonial room opening onto the shared verandah, with views towards the old town.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 3, "sizeSqm": 26, "view": "Verandah and station garden view", "smoking": "non_smoking", "roomAmenities": ["High ceilings", "Air conditioning", "Ceiling fan", "Coffee and tea making", "Shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '23c1ae40-bcea-506d-6dfc-5775a87bc6e5';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A spacious period room with extra beds for families visiting Ipoh by train.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 32, "view": "Verandah view", "smoking": "non_smoking", "roomAmenities": ["High ceilings", "Air conditioning", "Ceiling fan", "Coffee and tea making", "Shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '256dc8f2-b2c8-450b-af71-09316b4a4b8f';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A simple heritage room with timber doors and the basics for a night between trains.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed or 2 single beds", "maxGuests": 2, "sizeSqm": 18, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Ceiling fan", "Shower", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = '855f4dbc-3240-2365-a3e1-107f2a46275f';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'A corner suite with a sitting room and tall windows facing the station gardens.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 45, "view": "Station garden and old town view", "smoking": "non_smoking", "roomAmenities": ["Separate sitting room", "High ceilings", "Air conditioning", "Bathtub and shower", "Coffee and tea making", "Minibar (chargeable)", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'fca37053-ad44-41b4-ae6f-66b1e4468e65';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A comfortable colonial room with original timber details and a writing desk.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 22, "view": "Verandah view", "smoking": "non_smoking", "roomAmenities": ["High ceilings", "Air conditioning", "Writing desk", "Coffee and tea making", "Shower", "Free Wi-Fi"]}'::jsonb
WHERE id = '0bfaf339-43e0-4239-a987-d246c3ab177a';

-- photo 1 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Majestic_station_hotel_Ipoh_2024_01.jpg
-- photo 2 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:The_Majestic_Station_Hotel_Ipoh.JPG
-- photo 3 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Majestic_station_hotel_Ipoh_2024,_main_loggia_02.jpg
-- photo 4 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Ipoh_railway_station_2024,_Perak_Malaysia_07.jpg
DELETE FROM public.media_assets WHERE outlet_id = '03050469-be2d-c9a8-dc02-4a335da1f9ca' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('21db26ff-0bd0-e53e-2c91-3a32860e072e', '03050469-be2d-c9a8-dc02-4a335da1f9ca', 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Majestic_station_hotel_Ipoh_2024_01.jpg/1280px-Majestic_station_hotel_Ipoh_2024_01.jpg', 'image', -1, 'White colonial facade of the Majestic Station Hotel with columns and arched windows'),
  ('21db26ff-0bd0-e53e-2c91-3a32860e072e', '03050469-be2d-c9a8-dc02-4a335da1f9ca', 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Majestic_station_hotel_Ipoh_2024_01.jpg/1280px-Majestic_station_hotel_Ipoh_2024_01.jpg', 'image', 0, 'White colonial facade of the Majestic Station Hotel with columns and arched windows'),
  ('21db26ff-0bd0-e53e-2c91-3a32860e072e', '03050469-be2d-c9a8-dc02-4a335da1f9ca', 'https://upload.wikimedia.org/wikipedia/commons/e/ea/The_Majestic_Station_Hotel_Ipoh.JPG', 'image', 1, 'Verandah cafe with patterned tiles, ceiling lamps and rows of tables'),
  ('21db26ff-0bd0-e53e-2c91-3a32860e072e', '03050469-be2d-c9a8-dc02-4a335da1f9ca', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Majestic_station_hotel_Ipoh_2024%2C_main_loggia_02.jpg/1280px-Majestic_station_hotel_Ipoh_2024%2C_main_loggia_02.jpg', 'image', 2, 'Long sunlit loggia lined with tall timber doors'),
  ('21db26ff-0bd0-e53e-2c91-3a32860e072e', '03050469-be2d-c9a8-dc02-4a335da1f9ca', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Ipoh_railway_station_2024%2C_Perak_Malaysia_07.jpg/1280px-Ipoh_railway_station_2024%2C_Perak_Malaysia_07.jpg', 'image', 3, 'Domed white Ipoh railway station building, which houses the hotel');

-- ===== The Pacific Sutera =====
-- source (about): https://www.suteraharbour.com/the-pacific-sutera-hotel/
-- source (amenities): https://www.suteraharbour.com/the-pacific-sutera-hotel/
-- source (check-in/out): https://www.travelocity.com/es/Kota-Kinabalu-Hoteles-The-Pacific-Sutera-Hotel.h484236.Opiniones-Hotel
-- source (policies): invented for demo
-- note: Suite mapped to the Pacific Executive Suite (about 105 sqm); Deluxe Room to the official Deluxe Room (about 32 sqm, golf or sea view). Sizes from third-party listings. Check-in 15:00 per Travelocity (one source says 14:00). Pool photo is from Sutera Harbour Resort and may belong to the sister Magellan Sutera; marked not actual.
UPDATE public.outlets
SET hotel_about = 'A five-star seafront hotel in Sutera Harbour Resort, a short drive from central Kota Kinabalu, with about 500 rooms looking over the South China Sea, the marina or the resort''s 27-hole golf course. Guests can eat at Cafe Boleh and Breeze, watch the sunset from Horizons Sky Bar, use the resort pools and spa, and leave children at the Kids Club.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'swimming_pool', 'restaurant', 'breakfast', 'gym', 'front_desk_24h', 'laundry', 'airport_transfer', 'free_parking']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all rooms are non-smoking, with designated outdoor smoking areas. Children aged 3 to 12 can join the Kids Club, and extra beds can be added to Deluxe rooms for a nightly charge. A credit card or cash deposit is required at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'bcd9fdfc-0aae-2ce9-ed7c-15bfa71cd3c2';

-- Deluxe Room -- source: https://www.amazingborneo.com/index.php/package/sutera-harbour-resort-the-pacific-sutera
UPDATE public.products
SET description = 'A modern room with a king or twin beds and views of the golf course or the South China Sea.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 twin beds", "maxGuests": 3, "sizeSqm": 32, "view": "Golf course or sea view", "smoking": "non_smoking", "roomAmenities": ["Bathtub and shower", "Coffee and tea making", "Minibar", "In-room safe", "LCD TV", "Free Wi-Fi", "24-hour in-room dining"]}'::jsonb
WHERE id = 'ca12d415-79b5-f714-34ae-fa4857605554';

-- Suite -- source: https://www.amazingborneo.com/index.php/package/sutera-harbour-resort-the-pacific-sutera
UPDATE public.products
SET description = 'An Executive Suite with a separate bedroom and sitting area, facing the sea.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 4, "sizeSqm": 105, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Separate living area", "Bathtub and separate shower", "Coffee and tea making", "Minibar", "In-room safe", "LCD TV", "Free Wi-Fi", "24-hour in-room dining"]}'::jsonb
WHERE id = '117e3dab-d038-1894-3ebd-72aad4ab8b16';

-- photo 1 (this hotel, CC BY 2.5): https://commons.wikimedia.org/wiki/File:Sutera_Harbour_Resort.JPG
-- photo 2 (this hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Aerial_View_Of_Sutera_Harbour_Resort_(2517841756).jpg
-- photo 3 (similar hotel, CC BY 3.0): https://commons.wikimedia.org/wiki/File:Sutera_Harbour_Resort_-_panoramio.jpg
-- photo 4 (similar hotel, CC BY-SA 2.0): https://commons.wikimedia.org/wiki/File:Sutera_harbour_sunset.jpg
DELETE FROM public.media_assets WHERE outlet_id = 'bcd9fdfc-0aae-2ce9-ed7c-15bfa71cd3c2' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('90483cb0-eb9b-ac04-8c82-b761000ffd4d', 'bcd9fdfc-0aae-2ce9-ed7c-15bfa71cd3c2', 'https://upload.wikimedia.org/wikipedia/commons/c/cf/Sutera_Harbour_Resort.JPG', 'image', -1, 'The Pacific Sutera hotel tower above the resort golf course'),
  ('90483cb0-eb9b-ac04-8c82-b761000ffd4d', 'bcd9fdfc-0aae-2ce9-ed7c-15bfa71cd3c2', 'https://upload.wikimedia.org/wikipedia/commons/c/cf/Sutera_Harbour_Resort.JPG', 'image', 0, 'The Pacific Sutera hotel tower above the resort golf course'),
  ('90483cb0-eb9b-ac04-8c82-b761000ffd4d', 'bcd9fdfc-0aae-2ce9-ed7c-15bfa71cd3c2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Aerial_View_Of_Sutera_Harbour_Resort_%282517841756%29.jpg/1280px-Aerial_View_Of_Sutera_Harbour_Resort_%282517841756%29.jpg', 'image', 1, 'Aerial view of Sutera Harbour Resort with its marina and golf course'),
  ('90483cb0-eb9b-ac04-8c82-b761000ffd4d', 'bcd9fdfc-0aae-2ce9-ed7c-15bfa71cd3c2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Sutera_Harbour_Resort_-_panoramio.jpg/1280px-Sutera_Harbour_Resort_-_panoramio.jpg', 'image', 2, 'Rock waterfall swimming pool at Sutera Harbour Resort'),
  ('90483cb0-eb9b-ac04-8c82-b761000ffd4d', 'bcd9fdfc-0aae-2ce9-ed7c-15bfa71cd3c2', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Sutera_harbour_sunset.jpg/1280px-Sutera_harbour_sunset.jpg', 'image', 3, 'Fiery sunset over the yachts at Sutera Harbour marina');

-- ===== Thistle Johor Bahru =====
-- source (about): https://www.expedia.com/Johor-Bahru-Hotels-Thistle-Johor-Bahru.h2863029.Hotel-Information
-- source (amenities): https://www.expedia.com/Johor-Bahru-Hotels-Thistle-Johor-Bahru.h2863029.Hotel-Information
-- source (check-in/out): https://id.hotels.com/en/ho111753/thistle-johor-bahru-johor-bahru-malaysia
-- source (policies): https://id.hotels.com/en/ho111753/thistle-johor-bahru-johor-bahru-malaysia
-- note: No official website found; facts from booking listings. Check-in listed as 14:00 on one site and 15:00 on Hotels.com (15:00 used). Room mapping: Thistle Club Room = Executive Seaview King (club lounge, 387 sq ft), Family Room = Family Suite (72 sqm), Thistle Deluxe Room = higher-floor sea-view deluxe; Superior invented. Pool photo is of a different Malaysian hotel.
UPDATE public.outlets
SET hotel_about = 'A large waterfront hotel on Jalan Sungai Chat facing the Straits of Johor, about 10 minutes from the Causeway to Singapore. Its 382 rooms span 17 floors, with an outdoor pool and kids'' pool, a fitness centre, two restaurants, a club lounge for upper-floor guests and extensive banquet halls.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'gym', 'restaurant', 'breakfast', 'free_parking', 'front_desk_24h', 'laundry', 'air_conditioning']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all rooms are non-smoking. Guests must be 18 or older to check in, and a card or cash deposit is taken for incidentals. Extra beds and cots are available on request for a fee; early and late check-in depend on availability.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = 'ed896038-9f11-726f-b860-871210cedb0c';

-- Deluxe Room -- source: https://www.expedia.com/Johor-Bahru-Hotels-Thistle-Johor-Bahru.h2863029.Hotel-Information
UPDATE public.products
SET description = 'A deluxe room with a large window and city or garden outlook, good for short business trips.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 2, "sizeSqm": 30, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "In-room safe", "Minibar", "Coffee and tea making", "Bathtub or shower", "Free Wi-Fi", "24-hour room service"]}'::jsonb
WHERE id = 'eb578564-4efd-4e75-abc0-93a51c353aa1';

-- Family Room -- source: https://www.expedia.com/Johor-Bahru-Hotels-Thistle-Johor-Bahru.h2863029.Hotel-Information
UPDATE public.products
SET description = 'The family suite, with a separate living room and enough space for four or five guests.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 5, "sizeSqm": 72, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "In-room safe", "Minibar", "Coffee and tea making", "Bathtub or shower", "Free Wi-Fi", "24-hour room service", "Separate living room"]}'::jsonb
WHERE id = 'bd208735-8ac5-4885-ab8c-b53d021d650a';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A comfortable superior room with modern furnishings, ideal for weekend stays from Singapore.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 28, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "In-room safe", "Minibar", "Coffee and tea making", "Bathtub or shower", "Free Wi-Fi", "24-hour room service"]}'::jsonb
WHERE id = 'ef90272f-e911-475b-aaad-ca8bcff13540';

-- Thistle Club Room -- source: https://www.expedia.com/Johor-Bahru-Hotels-Thistle-Johor-Bahru.h2863029.Hotel-Information
UPDATE public.products
SET description = 'An executive sea-view room on the club floor, with access to the club lounge and its terrace.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 2, "sizeSqm": 36, "view": "Straits of Johor sea view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "In-room safe", "Minibar", "Coffee and tea making", "Bathtub or shower", "Free Wi-Fi", "24-hour room service", "Club lounge access"]}'::jsonb
WHERE id = '0dc62d4f-ad18-9854-73d9-2e8330e2009f';

-- Thistle Deluxe Room -- source: https://www.expedia.com/Johor-Bahru-Hotels-Thistle-Johor-Bahru.h2863029.Hotel-Information
UPDATE public.products
SET description = 'A deluxe room on a higher floor with views across the Straits of Johor.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 2, "sizeSqm": 32, "view": "Sea view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Flat-screen TV", "In-room safe", "Minibar", "Coffee and tea making", "Bathtub or shower", "Free Wi-Fi", "24-hour room service"]}'::jsonb
WHERE id = '78833fe1-1bde-1df5-1bcc-a74470270cd7';

-- photo 1 (this hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Thistle_Hotel.JPG
-- photo 2 (this hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Thistle_Hotel_-_Flickr.jpg
-- photo 3 (this hotel, CC BY 3.0): https://commons.wikimedia.org/wiki/File:Thistle_JB.JPG
-- photo 4 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Swimming_pool_of_Aloft_Kuala_Lumpur_Sentral,_Malaysia_-_20110726.jpg
DELETE FROM public.media_assets WHERE outlet_id = 'ed896038-9f11-726f-b860-871210cedb0c' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('f89cf595-36d8-d0c9-3e20-c30f563aa5d0', 'ed896038-9f11-726f-b860-871210cedb0c', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Thistle_Hotel.JPG/1280px-Thistle_Hotel.JPG', 'image', -1, 'Curved glass tower of Thistle Johor Bahru seen across a park'),
  ('f89cf595-36d8-d0c9-3e20-c30f563aa5d0', 'ed896038-9f11-726f-b860-871210cedb0c', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Thistle_Hotel.JPG/1280px-Thistle_Hotel.JPG', 'image', 0, 'Curved glass tower of Thistle Johor Bahru seen across a park'),
  ('f89cf595-36d8-d0c9-3e20-c30f563aa5d0', 'ed896038-9f11-726f-b860-871210cedb0c', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Thistle_Hotel_-_Flickr.jpg/1280px-Thistle_Hotel_-_Flickr.jpg', 'image', 1, 'Curved facade of Thistle Johor Bahru with its rooftop sign'),
  ('f89cf595-36d8-d0c9-3e20-c30f563aa5d0', 'ed896038-9f11-726f-b860-871210cedb0c', 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Thistle_JB.JPG/1280px-Thistle_JB.JPG', 'image', 2, 'Club floor terrace at Thistle Johor Bahru overlooking the Straits'),
  ('f89cf595-36d8-d0c9-3e20-c30f563aa5d0', 'ed896038-9f11-726f-b860-871210cedb0c', 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Swimming_pool_of_Aloft_Kuala_Lumpur_Sentral%2C_Malaysia_-_20110726.jpg', 'image', 3, 'Free-form hotel swimming pool surrounded by palms, seen from above');

-- ===== Thistle Port Dickson =====
-- source (about): https://uk.trip.com/hotels/si-rusa-hotel-detail-781030/thistle-port-dickson-resort/
-- source (amenities): https://uk.trip.com/hotels/si-rusa-hotel-detail-781030/thistle-port-dickson-resort/
-- source (check-in/out): https://uk.trip.com/hotels/si-rusa-hotel-detail-781030/thistle-port-dickson-resort/
-- source (policies): https://uk.trip.com/hotels/si-rusa-hotel-detail-781030/thistle-port-dickson-resort/
-- note: No official site found; facts from Trip.com listing (Expedia/Travelocity give 11:00 check-out, Trip.com gives 12:00). Mapping: Standard Room = Sunset Twin Room (41 sqm); Superior Room = Premier Gardenview King; Deluxe Room = Premier Sunset Twin; Sea View Room = Deluxe King/Twin sea front view; Family Room = Thistle Family Sea Front Room. Sizes other than 41 sqm are guesses.
UPDATE public.outlets
SET hotel_about = 'A large beachfront resort at KM16 on the Teluk Kemang coast road, opened in 1996 with about 251 rooms and its own stretch of beach. It suits families, with two pools including a children''s pool with a water slide, a playground, tennis court, games room and spa, and three restaurants plus a poolside bar.',
    amenity_codes = ARRAY['wifi', 'swimming_pool', 'gym', 'restaurant', 'breakfast', 'free_parking', 'front_desk_24h', 'laundry', 'air_conditioning', 'accessible']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed; smoking is limited to designated outdoor areas. The main guest must be 18 or older, and children 4 and under eat breakfast free. A MYR300 deposit is charged to a credit card at check-in and refunded within 7 days of check-out.',
    wheelchair_accessible = true,
    pet_friendly = false
WHERE id = '2caca22f-a15a-ecdd-dd6e-7a06d41aa0b8';

-- Deluxe Room -- source: https://uk.trip.com/hotels/si-rusa-hotel-detail-781030/thistle-port-dickson-resort/
UPDATE public.products
SET description = 'A refurbished premier twin room on the sunset side, facing the pools and the evening sky.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 3, "sizeSqm": 42, "view": "Pool and sunset view", "smoking": "non_smoking", "roomAmenities": ["Bathtub with shower", "Balcony", "Flat-screen TV", "Coffee and tea making", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '8b8e2fa3-df8e-4903-a416-f56179a5fc80';

-- Family Room -- source: https://ph.trip.com/hotels/si-rusa-hotel-detail-781030/thistle-port-dickson
UPDATE public.products
SET description = 'A large sea-front family room with space for two adults and two children near the kids'' pool.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 2 single beds", "maxGuests": 4, "sizeSqm": 55, "view": "Sea front view", "smoking": "non_smoking", "roomAmenities": ["Bathtub with shower", "Sea-facing balcony", "Flat-screen TV", "Coffee and tea making", "Mini fridge", "Electronic safe", "Free Wi-Fi", "Daily housekeeping"]}'::jsonb
WHERE id = 'de4c15aa-cebe-431a-a2da-2e170779c59b';

-- Sea View Room -- source: https://ph.trip.com/hotels/si-rusa-hotel-detail-781030/thistle-port-dickson
UPDATE public.products
SET description = 'A deluxe sea-front room with a balcony looking straight out over the Strait of Malacca.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 3, "sizeSqm": 45, "view": "Sea front view", "smoking": "non_smoking", "roomAmenities": ["Bathtub with shower", "Sea-facing balcony", "Flat-screen TV", "Coffee and tea making", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '04dd8074-98fe-7846-8bea-5f2a5b337afa';

-- Standard Room -- source: https://uk.trip.com/hotels/si-rusa-hotel-detail-781030/thistle-port-dickson-resort/
UPDATE public.products
SET description = 'A newly refurbished twin room on the lower floors, a simple and spacious choice for friends.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 2, "sizeSqm": 41, "view": "Inner courtyard view", "smoking": "non_smoking", "roomAmenities": ["Shower", "Flat-screen TV", "Coffee and tea making", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '7801d6d0-0abf-22c0-5411-c57b83ce138f';

-- Superior Room -- source: https://uk.trip.com/hotels/si-rusa-hotel-detail-781030/thistle-port-dickson-resort/
UPDATE public.products
SET description = 'A refurbished premier room with a king bed overlooking the resort gardens.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 42, "view": "Garden view", "smoking": "non_smoking", "roomAmenities": ["Bathtub with shower", "Balcony", "Flat-screen TV", "Coffee and tea making", "Mini fridge", "Electronic safe", "Free Wi-Fi"]}'::jsonb
WHERE id = '7742b0fe-7fed-4e0d-a34e-b49e10beb81d';

-- photo 1 (this hotel, CC BY 3.0): https://commons.wikimedia.org/wiki/File:Thistle_PD_Resort.JPG
-- photo 2 (similar hotel, CC BY-SA 3.0): https://commons.wikimedia.org/wiki/File:Teluk_Kemang_Beach,_Port_Dickson_(2).jpg
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/swimming-pool-near-palm-trees-during-daytime-D1yT791Nf9A
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/modern-hotel-room-with-two-beds-and-large-windows-pe1xVjJJlE4
DELETE FROM public.media_assets WHERE outlet_id = '2caca22f-a15a-ecdd-dd6e-7a06d41aa0b8' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('c06f6a6f-59fc-9f81-e087-a38e077ede7e', '2caca22f-a15a-ecdd-dd6e-7a06d41aa0b8', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Thistle_PD_Resort.JPG/1280px-Thistle_PD_Resort.JPG', 'image', -1, 'Bird''s-eye view of Thistle Port Dickson Resort'),
  ('c06f6a6f-59fc-9f81-e087-a38e077ede7e', '2caca22f-a15a-ecdd-dd6e-7a06d41aa0b8', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Thistle_PD_Resort.JPG/1280px-Thistle_PD_Resort.JPG', 'image', 0, 'Bird''s-eye view of Thistle Port Dickson Resort'),
  ('c06f6a6f-59fc-9f81-e087-a38e077ede7e', '2caca22f-a15a-ecdd-dd6e-7a06d41aa0b8', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Teluk_Kemang_Beach%2C_Port_Dickson_%282%29.jpg/1280px-Teluk_Kemang_Beach%2C_Port_Dickson_%282%29.jpg', 'image', 1, 'Parasols along Teluk Kemang Beach, Port Dickson'),
  ('c06f6a6f-59fc-9f81-e087-a38e077ede7e', '2caca22f-a15a-ecdd-dd6e-7a06d41aa0b8', 'https://images.unsplash.com/photo-1623718649591-311775a30c43?w=1280&q=80', 'image', 2, 'Resort swimming pool surrounded by palm trees'),
  ('c06f6a6f-59fc-9f81-e087-a38e077ede7e', '2caca22f-a15a-ecdd-dd6e-7a06d41aa0b8', 'https://images.unsplash.com/photo-1776500587913-6e55907a738e?w=1280&q=80', 'image', 3, 'Modern hotel room with two beds and large windows');

-- ===== Timotel Hotel =====
-- source (about): https://www.agoda.com/timotel-hotel/hotel/mersing-my.html
-- source (amenities): https://www.agoda.com/timotel-hotel/hotel/mersing-my.html
-- source (check-in/out): https://www.agoda.com/timotel-hotel/hotel/mersing-my.html
-- source (policies): invented for demo
-- note: No official website found; facts come from Agoda and Cvent. Room mapping: Timotel Standard Room = Agoda Standard (26 sqm, 2 adults); Family Room = Family Suite. Superior, Deluxe and Timotel Deluxe Rooms are invented, with sizes graded above Standard. Parking is listed as free on Agoda but paid on Cvent. No openly licensed photos of the hotel exist; the cover shows nearby hotels in Mersing town.
UPDATE public.outlets
SET hotel_about = 'A modest 44-room hotel in Mersing town, handy for the jetty where ferries leave for Tioman and the other islands. Rooms are air-conditioned with satellite TV, and the on-site restaurant serves Western and local dishes with a well-liked breakfast. There is no pool; the hotel suits travellers staying overnight before or after an island trip.',
    amenity_codes = ARRAY['wifi', 'restaurant', 'breakfast', 'front_desk_24h', 'laundry', 'free_parking']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'Pets are not allowed and all rooms are non-smoking. Luggage can be stored at the front desk for guests heading to the islands. One extra bed is available in Deluxe rooms for a nightly fee, and a refundable cash deposit is collected at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '8384985a-4c96-1d9a-adb5-817ad824ca4e';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A roomier double or twin room with a small seating corner and a mini fridge.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 3, "sizeSqm": 30, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Satellite TV", "Mini fridge", "Electric kettle", "Wardrobe", "Shower and hairdryer", "Free Wi-Fi"]}'::jsonb
WHERE id = '479a670b-3dd0-40bf-a226-417485d13735';

-- Family Room -- source: https://www.agoda.com/timotel-hotel/hotel/mersing-my.html
UPDATE public.products
SET description = 'A family suite with room for four, useful for families catching an early ferry.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 40, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Satellite TV", "Mini fridge", "Electric kettle", "Wardrobe", "Shower and hairdryer", "Free Wi-Fi"]}'::jsonb
WHERE id = '08902f0a-5df9-4b0f-ab0d-7889c4bfc07d';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A neat air-conditioned room with satellite TV, slightly larger than Standard.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 28, "view": "Town or inner view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Satellite TV", "Mini fridge", "Electric kettle", "Wardrobe", "Shower and hairdryer", "Free Wi-Fi"]}'::jsonb
WHERE id = '8425311c-8ec7-4b0d-a99a-dd1d4fa78c1d';

-- Timotel Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'The largest double room, with a sofa and a work desk for longer stays in Mersing.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 32, "view": "Town view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Satellite TV", "Sofa", "Work desk", "Mini fridge", "Electric kettle", "Shower and hairdryer", "Free Wi-Fi"]}'::jsonb
WHERE id = 'd8c0e176-4520-1997-2fa4-756c6ae2c975';

-- Timotel Standard Room -- source: https://www.agoda.com/timotel-hotel/hotel/mersing-my.html
UPDATE public.products
SET description = 'A basic, clean room for two with everything needed for a night before the ferry.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 double bed or 2 single beds", "maxGuests": 2, "sizeSqm": 26, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Satellite TV", "Mini fridge", "Electric kettle", "Wardrobe", "Shower", "Free Wi-Fi"]}'::jsonb
WHERE id = 'cab22d38-ac45-9e13-408a-07ef8a9ff2f9';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Mersing_-_hotels_and_restaurants_on_Jalan_Sulaiman_-_May_2024.jpg
-- photo 2 (similar hotel, Unsplash License): https://unsplash.com/photos/mQ3aqyOUk8Q
-- photo 3 (similar hotel, Unsplash License): https://unsplash.com/photos/pJ2S96Ycxmo
-- photo 4 (similar hotel, Unsplash License): https://unsplash.com/photos/5BV56SdvLmo
DELETE FROM public.media_assets WHERE outlet_id = '8384985a-4c96-1d9a-adb5-817ad824ca4e' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('3399032f-4414-f406-ca43-5e5765c1d18b', '8384985a-4c96-1d9a-adb5-817ad824ca4e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Mersing_-_hotels_and_restaurants_on_Jalan_Sulaiman_-_May_2024.jpg/1280px-Mersing_-_hotels_and_restaurants_on_Jalan_Sulaiman_-_May_2024.jpg', 'image', -1, 'Row of small hotels and restaurants in Mersing town centre'),
  ('3399032f-4414-f406-ca43-5e5765c1d18b', '8384985a-4c96-1d9a-adb5-817ad824ca4e', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Mersing_-_hotels_and_restaurants_on_Jalan_Sulaiman_-_May_2024.jpg/1280px-Mersing_-_hotels_and_restaurants_on_Jalan_Sulaiman_-_May_2024.jpg', 'image', 0, 'Row of small hotels and restaurants in Mersing town centre'),
  ('3399032f-4414-f406-ca43-5e5765c1d18b', '8384985a-4c96-1d9a-adb5-817ad824ca4e', 'https://images.unsplash.com/photo-1510156442041-cdf66f950321?w=1280&q=80', 'image', 1, 'Rattan chairs and a small table by a sunny window'),
  ('3399032f-4414-f406-ca43-5e5765c1d18b', '8384985a-4c96-1d9a-adb5-817ad824ca4e', 'https://images.unsplash.com/photo-1698752160677-7e112b18e5a0?w=1280&q=80', 'image', 2, 'Simple hotel bedroom with teal bedding, two chairs and blue curtains'),
  ('3399032f-4414-f406-ca43-5e5765c1d18b', '8384985a-4c96-1d9a-adb5-817ad824ca4e', 'https://images.unsplash.com/photo-1631049552057-403cdb8f0658?w=1280&q=80', 'image', 3, 'Hotel room with a bed and a sofa beside large windows');

-- ===== Tune Hotel =====
-- source (about): https://tunehotels.com/malaysia-hotels/kota-bharu-city-centre-kelantan/
-- source (amenities): https://tunehotels.com/malaysia-hotels/kota-bharu-city-centre-kelantan/
-- source (check-in/out): https://tunehotels.com/malaysia-hotels/kota-bharu-city-centre-kelantan/
-- source (policies): https://tunehotels.com/malaysia-hotels/kota-bharu-city-centre-kelantan/
-- note: Official Tune Hotels Kota Bharu City Centre offers only 14 sqm Double, Standard Twin and Twin Without Window rooms. Mapping: Standard = Twin Without Window, Superior = Standard Twin, Deluxe = Double Room (all 14 sqm per official site). Family Room and Suite do not exist officially and are invented. No pool or gym. Photos show other Tune Hotel branches and Kota Bharu, not this branch.
UPDATE public.outlets
SET hotel_about = 'A no-frills budget hotel at KB City Centre (KBCC) on Jalan Hamzah, next to KB Mall and a short ride from Siti Khadijah Market and the Gelanggang Seni cultural centre. Compact rooms have quality beds, power showers and air-conditioning, and there is a 24-hour front desk, free Wi-Fi, a prayer room and cafes including Starbucks on site.',
    amenity_codes = ARRAY['wifi', 'air_conditioning', 'front_desk_24h', 'free_parking']::text[],
    check_in_time = '14:00',
    check_out_time = '11:00',
    stay_policies = 'The hotel is strictly non-smoking indoors, with designated smoking areas outside. Standard rooms take up to 2 adults and 1 child under 5. Most rates cannot be cancelled or changed; Flexible Rate bookings can be cancelled up to 48 hours before arrival, and no-shows are charged in full.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '82874da0-30eb-f1bc-8f45-4cc62c8cbd14';

-- Deluxe Room -- source: https://tunehotels.com/malaysia-hotels/kota-bharu-city-centre-kelantan/
UPDATE public.products
SET description = 'A double room with a queen-size bed, ideal for couples on a city break.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 14, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Hot power shower", "Air-conditioning and ceiling fan", "TV", "Free Wi-Fi", "In-room safe", "Hairdryer", "Towels and toiletries kit", "Drinking water"]}'::jsonb
WHERE id = '7fb21e3e-d45a-4e76-a836-ddf9d95e6e2a';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A larger room with a queen bed and two singles for small families.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed and 2 single beds", "maxGuests": 4, "sizeSqm": 22, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Hot power shower", "Air-conditioning and ceiling fan", "TV", "Free Wi-Fi", "In-room safe", "Hairdryer", "Towels and toiletries kit"]}'::jsonb
WHERE id = '9185258e-e4ab-e057-0285-c55d3262d04a';

-- Standard Room -- source: https://tunehotels.com/malaysia-hotels/kota-bharu-city-centre-kelantan/
UPDATE public.products
SET description = 'A windowless twin room with two single beds, a table and chair, and a hot power shower.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 2, "sizeSqm": 14, "view": "No window", "smoking": "non_smoking", "roomAmenities": ["Hot power shower", "Air-conditioning and ceiling fan", "TV", "Free Wi-Fi", "In-room safe", "Hairdryer", "Towels and toiletries kit"]}'::jsonb
WHERE id = '90e3097b-c635-6b1d-4218-7ea1e7df89af';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'The roomiest option, with a king bed, a sofa bed and a small seating area.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed and 1 sofa bed", "maxGuests": 3, "sizeSqm": 26, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Hot power shower", "Air-conditioning and ceiling fan", "TV", "Free Wi-Fi", "In-room safe", "Hairdryer", "Sofa seating", "Drinking water"]}'::jsonb
WHERE id = '802caeb4-bb2e-484f-aae4-fa01f67bd7c3';

-- Superior Room -- source: https://tunehotels.com/malaysia-hotels/kota-bharu-city-centre-kelantan/
UPDATE public.products
SET description = 'A twin room with two single King Koil beds and a window over the city centre.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 single beds", "maxGuests": 2, "sizeSqm": 14, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Hot power shower", "Air-conditioning and ceiling fan", "TV", "Free Wi-Fi", "In-room safe", "Hairdryer", "Towels and toiletries kit"]}'::jsonb
WHERE id = '97d94922-345d-420a-a17c-02472c5986e1';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Tune_Hotel_Danga_Bay.jpg
-- photo 2 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:KL-Tune_Hotel_Jalan_Tuanku_Abdul_Rahman.JPG
-- photo 3 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Bed_in_hotel_room_4.jpg
-- photo 4 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:Kota_Bharu_clocktower.jpg
DELETE FROM public.media_assets WHERE outlet_id = '82874da0-30eb-f1bc-8f45-4cc62c8cbd14' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('a4fcfdb3-3230-d5fe-a294-5d853cbaa04a', '82874da0-30eb-f1bc-8f45-4cc62c8cbd14', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Tune_Hotel_Danga_Bay.jpg/1280px-Tune_Hotel_Danga_Bay.jpg', 'image', -1, 'Red and white Tune Hotel building at Danga Bay, Johor (sister branch)'),
  ('a4fcfdb3-3230-d5fe-a294-5d853cbaa04a', '82874da0-30eb-f1bc-8f45-4cc62c8cbd14', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Tune_Hotel_Danga_Bay.jpg/1280px-Tune_Hotel_Danga_Bay.jpg', 'image', 0, 'Red and white Tune Hotel building at Danga Bay, Johor (sister branch)'),
  ('a4fcfdb3-3230-d5fe-a294-5d853cbaa04a', '82874da0-30eb-f1bc-8f45-4cc62c8cbd14', 'https://upload.wikimedia.org/wikipedia/commons/5/50/KL-Tune_Hotel_Jalan_Tuanku_Abdul_Rahman.JPG', 'image', 1, 'Tune Hotel branch on Jalan Tuanku Abdul Rahman, Kuala Lumpur'),
  ('a4fcfdb3-3230-d5fe-a294-5d853cbaa04a', '82874da0-30eb-f1bc-8f45-4cc62c8cbd14', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Bed_in_hotel_room_4.jpg/1280px-Bed_in_hotel_room_4.jpg', 'image', 2, 'Compact budget hotel room with a double bed'),
  ('a4fcfdb3-3230-d5fe-a294-5d853cbaa04a', '82874da0-30eb-f1bc-8f45-4cc62c8cbd14', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Kota_Bharu_clocktower.jpg/1280px-Kota_Bharu_clocktower.jpg', 'image', 3, 'Clock tower in central Kota Bharu, Kelantan');

-- ===== Twenty Trees Boutique Hotel =====
-- source (about): https://findit.city/en/malaysia/kuala-lumpur/places/hotels/twenty-trees-boutique-hotel-6171380436
-- source (amenities): invented for demo
-- source (check-in/out): invented for demo
-- source (policies): invented for demo
-- note: Only a directory listing exists (Suri Puteri Business Avenue, Seksyen 20); no website or reviews found, so it may be closed or renamed. Facilities, policies and rooms invented for demo. Cover shows a different Shah Alam hotel (De Palma) as a stand-in.
UPDATE public.outlets
SET hotel_about = 'A small boutique hotel at Suri Puteri Business Avenue in Seksyen 20, Shah Alam, with green, nature-inspired interiors and a relaxed cafe on the ground floor. It suits visitors heading to events at Setia City Convention Centre, i-City or the Shah Alam lake gardens.',
    amenity_codes = ARRAY['wifi', 'breakfast', 'restaurant', 'free_parking', 'front_desk_24h', 'air_conditioning']::text[],
    check_in_time = '15:00',
    check_out_time = '12:00',
    stay_policies = 'This is a non-smoking hotel and pets are not allowed. Children under 6 stay free using existing beds, and one extra bed can be added in Deluxe and Family rooms for a fee. A refundable deposit of MYR100 is collected at check-in.',
    wheelchair_accessible = false,
    pet_friendly = false
WHERE id = '634dd5be-cf02-e9d6-1e87-801ae12678db';

-- Deluxe Room -- source: invented for demo
UPDATE public.products
SET description = 'A deluxe room with warm timber finishes, a work desk and plenty of natural light.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed or 2 single beds", "maxGuests": 3, "sizeSqm": 26, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Smart TV", "Rain shower", "Kettle with tea and coffee", "Free Wi-Fi", "Work desk", "Daily housekeeping"]}'::jsonb
WHERE id = '3a2f1224-ab87-6ed0-6e27-d626a6b9c33d';

-- Family Room -- source: invented for demo
UPDATE public.products
SET description = 'A family room with two queen beds and a relaxed, leafy design for families.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "2 queen beds", "maxGuests": 4, "sizeSqm": 32, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Smart TV", "Rain shower", "Kettle with tea and coffee", "Free Wi-Fi", "Work desk", "Daily housekeeping"]}'::jsonb
WHERE id = 'fd214864-2e3a-411a-ae43-869c15da5f4f';

-- Standard Room -- source: invented for demo
UPDATE public.products
SET description = 'A compact standard room with clean modern styling for short stays.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed", "maxGuests": 2, "sizeSqm": 17, "view": "Inner view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Smart TV", "Rain shower", "Kettle with tea and coffee", "Free Wi-Fi", "Work desk", "Daily housekeeping"]}'::jsonb
WHERE id = 'e65f2309-5b08-eda7-d861-3403fa7a7986';

-- Suite -- source: invented for demo
UPDATE public.products
SET description = 'The boutique suite, with a separate lounge area and botanical-themed decor.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 king bed", "maxGuests": 3, "sizeSqm": 40, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Smart TV", "Rain shower", "Kettle with tea and coffee", "Free Wi-Fi", "Work desk", "Daily housekeeping", "Sitting area", "Mini fridge"]}'::jsonb
WHERE id = 'caa7c027-496c-43ce-ac6c-f441a5ba587b';

-- Superior Room -- source: invented for demo
UPDATE public.products
SET description = 'A superior room with a comfortable bed and soft green accents.',
    attributes = COALESCE(attributes, '{}'::jsonb) || '{"bedType": "1 queen bed or 2 single beds", "maxGuests": 2, "sizeSqm": 21, "view": "City view", "smoking": "non_smoking", "roomAmenities": ["Air conditioning", "Smart TV", "Rain shower", "Kettle with tea and coffee", "Free Wi-Fi", "Work desk", "Daily housekeeping"]}'::jsonb
WHERE id = '2274bd57-f17c-4a4d-a89b-30a50431b5e9';

-- photo 1 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:De_Palma_Hotel_Shah_Alam_(20230304_131632).jpg
-- photo 2 (similar hotel, CC BY 2.0): https://commons.wikimedia.org/wiki/File:Shah_Alam_Lake_Gardens,_Selangor.jpg
-- photo 3 (similar hotel, CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:EXECUTIVE_ROOM_-_Teraskita_Hotel_Makassar.jpg
-- photo 4 (similar hotel, CC0): https://commons.wikimedia.org/wiki/File:Room_with_1_Queen_Bed_-_Sonder_Rose_(Rotterdam)_2024-12-01.jpg
DELETE FROM public.media_assets WHERE outlet_id = '634dd5be-cf02-e9d6-1e87-801ae12678db' AND product_id IS NULL;
INSERT INTO public.media_assets (vendor_id, outlet_id, url, media_type, sort_order, alt_text) VALUES
  ('102a5e48-fea5-a499-8e2b-cd58755ebfaf', '634dd5be-cf02-e9d6-1e87-801ae12678db', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/De_Palma_Hotel_Shah_Alam_%2820230304_131632%29.jpg/1280px-De_Palma_Hotel_Shah_Alam_%2820230304_131632%29.jpg', 'image', -1, 'Low-rise hotel building in Shah Alam'),
  ('102a5e48-fea5-a499-8e2b-cd58755ebfaf', '634dd5be-cf02-e9d6-1e87-801ae12678db', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/De_Palma_Hotel_Shah_Alam_%2820230304_131632%29.jpg/1280px-De_Palma_Hotel_Shah_Alam_%2820230304_131632%29.jpg', 'image', 0, 'Low-rise hotel building in Shah Alam'),
  ('102a5e48-fea5-a499-8e2b-cd58755ebfaf', '634dd5be-cf02-e9d6-1e87-801ae12678db', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Shah_Alam_Lake_Gardens%2C_Selangor.jpg/1280px-Shah_Alam_Lake_Gardens%2C_Selangor.jpg', 'image', 1, 'Lake and pavilions at Shah Alam Lake Gardens'),
  ('102a5e48-fea5-a499-8e2b-cd58755ebfaf', '634dd5be-cf02-e9d6-1e87-801ae12678db', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/EXECUTIVE_ROOM_-_Teraskita_Hotel_Makassar.jpg/1280px-EXECUTIVE_ROOM_-_Teraskita_Hotel_Makassar.jpg', 'image', 2, 'Modern hotel room with a desk, TV and king bed'),
  ('102a5e48-fea5-a499-8e2b-cd58755ebfaf', '634dd5be-cf02-e9d6-1e87-801ae12678db', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/Room_with_1_Queen_Bed_-_Sonder_Rose_%28Rotterdam%29_2024-12-01.jpg/1280px-Room_with_1_Queen_Bed_-_Sonder_Rose_%28Rotterdam%29_2024-12-01.jpg', 'image', 3, 'Contemporary boutique hotel room with a queen bed');
