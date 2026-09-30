# Event vendors, multi-location events, and event reservations

**Status:** Approved 2026-09-30. All phases (1–6) done (see the outcome notes below).

**Refund rule (confirmed 2026-10-01):** automatic refund only while the
whole event has not started yet (`promotion_campaigns.starts_at`); otherwise
the refund is manual by admin.

Builds on `2026-09-28-1732-vendor-fair-event-participation.md` (events,
vendor registration, announcements) and the event-promotion pause/resume
work. Source: stakeholder feedback received 2026-09-30.

## 1. Context

Today an event (`promotion_campaigns`) is a single poster, date range and
free-text operating-hours line. Vendors register for the whole event, and
the products they list are display-only. Nobody can buy anything at an
event.

The feedback asks for a tourism-campaign model:

> campaign → many vendors → many locations → different products

Customers should be able to reserve and pay for event items ahead of time,
pick a location, date and time to collect them, and redeem a QR code at the
stall. A new kind of seller, the **event vendor**, only sells at events and
must never look like a normal shop.

## 2. Decisions (agreed with product owner)

1. **Locations**
   - An event has **multiple locations**, each with its **own dates and
     daily hours** (e.g. a roadshow moving between cities).
2. **Event vendor**
   - Event vendors get a **new role and their own portal**.
   - They are **never shown as a normal vendor**: they are always labelled
     "Event partner" and never appear in regular vendor listings.
   - Their items can only be reserved while they are participating in an
     event location.
3. **Who joins events**
   - **Both** event vendors and existing shop vendors can join events.
   - A vendor joins **per location**, and may join many events and many
     locations.
4. **Onboarding**
   - Admin creates an event vendor, and the owner gets an **email invite**
     (existing `/vendor-invite` flow).
   - From then on, event invitations arrive through the **announcement
     inbox**, and the vendor joins through the **registration form**.
   - Admin-created event vendors **still go through vendor approval + KYC
     review** before they can sell.
5. **Event products**
   - Items listed for an event are **not** added to the vendor's catalog.
   - Each registration's items are purchasable **event listings**. A
     listing either references an existing catalog product (for name and
     photo) or carries its own name, price and photo.
6. **Ordering**
   - **Pre-orders are allowed** once the vendor is approved for a
     location, for any pickup date within that location's schedule.
   - Pickup only happens during the event.
7. **Pickup selection** *(revised 2026-09-30)*
   - The customer picks **location, date and time slot**.
   - Slots are **vendor-defined windows** per location, the same every day,
     plus optional extra windows on specific dates.
   - Each slot has a vendor-set **maximum reservations**.
8. **Stock**
   - The vendor sets a **quantity per listing, per location, per day**.
   - When sold out, that day can't be reserved.
9. **Pricing**
   - Physical products are **paid in full**.
   - Services and experiences are priced by the vendor. **RM0 means a free
     reservation.**
   - The standard platform commission applies to paid lines.
10. **QR codes**
    - Customers get a QR code as with current purchases.
    - It is valid for the **whole pickup date** (Malaysia time), not tied to
      the time slot.
11. **Cancellation after pre-payment**
    - This applies when the event or location is paused or archived, or the
      vendor's registration is rejected or withdrawn.
    - If today (Malaysia time) is **before that location's start date**, paid
      reservations are **refunded automatically**.
    - Otherwise they are **flagged for manual admin refund**.
12. **Customer surfaces**
    - A new **"Events"** item in the navbar leads to an events page with
      **List / Calendar / Map** views.
    - The home page keeps the existing featured-event spotlight as a
      teaser.
    - Nothing event-related appears on Explore.
    - The Partners page shows event vendors under an **"Event partners"**
      label.
    - An event vendor's page shows their items as a table: **product,
      location, date, time**, price, and a reserve action. Reserving is
      disabled with "No upcoming event" when they aren't participating
      anywhere.

### Out of scope

- Paid vendor event ads (`vendor_event_promotions`, admin "Event Promos"):
  unchanged.
- The regular catalog, outlets, bookings and vouchers for shop vendors:
  unchanged.
- Automatic address geocoding. Admin enters the address and places a pin on
  the map.

## 3. Reuse audit

| Candidate | Path | Decision | Notes |
|---|---|---|---|
| Events | `promotion_campaigns` + admin page `app/admin/promotion-campaigns/page.tsx` | **Extend** | Stays the event. Gains a locations child table. |
| Vendor registrations | `promotion_campaign_vendors`, `submit/resubmit/review_campaign_vendor_registration` RPCs, `app/vendor/events/[id]/page.tsx`, `app/admin/event-registrations/*` | **Extend** | A registration becomes per location (unique `(event_location_id, vendor_id)`). |
| Registration items | `promotion_campaign_vendor_products` | **Extend** | Already models "catalog product OR own name/price/photo". Gains kind, daily quantity and active flag, and becomes the purchasable event listing. Not renamed. |
| Announcements + invites | `vendor_announcements`, `app/vendor/announcements/*`, `/vendor-invite` flow, `app/api/admin/vendors/recommendation-invite` | **Reuse** | Event invitations and new-vendor email invites. |
| Vendor approval / KYC | `staff_review_vendor`, `app/admin/vendors/page.tsx`, KYC flow | **Reuse** | Event vendors go through the same review. |
| Roles + login routing | `user_roles` / `roles`, `lib/auth/post-login-destination.ts` | **Extend** | New `event_vendor` role and home. |
| Vendor API auth | `lib/vendor-authorization.ts` (`authorizeVendor`, 52 routes) | **Extend** | Explicit allow/deny for event vendors. |
| Portal shell | `app/vendor/layout.tsx`, `components/layout/portal-sidebar.tsx`, `lib/vendor/navigation.ts` | **Reuse** | Event-vendor navigation set. Shell component unchanged. |
| Checkout | `prepare_checkout`, `prepare_checkout_with_food_service_modes`, `finalize_checkout`, `app/api/checkout/*`, `checkout_reservations` | **Extend** | New order-line kind and hold kind. Price looked up on the server. |
| QR + scanning | `ticket_passes`, `admit_ticket_pass`, `app/vendor/scanner`, `app/api/vendors/[vendorId]/scanner` | **Extend** | Pickup-date-only validity. Scanner is part of the event-vendor portal. |
| Free reservations | free-reservation checkout path (`20260904240000_free_activity_reservations.sql`) | **Reuse** | Used for RM0 services. |
| Settlement + commission | `settle_order_vendor_earnings`, `reverse_order_vendor_settlement` | **Reuse unchanged** | Groups lines by `vendor_id`. Event vendors are vendor rows. |
| Refunds | `refunds` table, `begin_simulated_refund` / `settle_simulated_refund`, `app/admin/refunds/*` | **Reuse** | Automatic path creates and processes refunds. Manual path queues them for admin. |
| Map | `components/map/maplibre-map.tsx` (maplibre-gl installed) | **Reuse** | Events map view and the admin location pin. |
| Calendar | FullCalendar + `.mw-customer-calendar` skin (`app/customer/calendar`) | **Reuse** | Events calendar view. |
| Partners directory | `app/customer/partners/page.tsx`, `app/customer/search/search-client.tsx`, `backend/domains/catalogue.ts#getVendors` | **Extend** | Exclude event vendors from normal lists. Add an "Event partners" section. |
| Customer vendor page | `app/customer/vendor/[vendorId]/page.tsx` | **Extend** | Event vendors get the reservation table. |
| Header navigation | `lib/customer/header-navigation.ts` | **Extend** | "Events" item. |
| Event detail pages | `app/customer/events/*`, `app/customer/events/[slug]/[vendorId]` | **Extend** | Add locations and reserve entry points. |

**Rejected**

- **A new standalone event-products table:** rejected.
  `promotion_campaign_vendor_products` already models exactly this.
- **Separate order or payment tables for events:** rejected. Reusing
  `orders` / `order_items` keeps commission, settlement, refunds, the QR
  flow and reports working.

Reuse audit complete.

## 4. Database changes (summary)

1. **Event locations: new `promotion_campaign_locations` table**
   - Columns: `campaign_id`, name, address, `lat`, `lng`, `starts_on`,
     `ends_on`, `opens_at`, `closes_at`, status.
   - The campaign's own dates become the span of its locations.
2. **Registrations become per location**
   - `promotion_campaign_vendors` gains `event_location_id`, with unique
     `(event_location_id, vendor_id)`.
   - Existing rows are backfilled to a default location created from each
     campaign's current dates and hours.
3. **Event listings**
   - `promotion_campaign_vendor_products` gains `item_kind`
     (`product`/`service`), `daily_quantity`, and `active`.
4. **Event vendor type and role**
   - `vendors` gains `kind` (`shop`/`event`, default `shop`).
   - New `roles` row: `event_vendor`.
5. **Order lines for event reservations**
   - `order_items` gains `event_listing_id`, `event_location_id`,
     `pickup_date` and `pickup_slot`.
   - `outlet_id` becomes nullable, under a CHECK that each line has either
     an outlet or an event location.
6. **Event stock holds**
   - `checkout_reservations` gains kind `event`, keyed by listing + pickup
     date.
   - Capacity is checked under a row lock.
7. **QR validity**
   - Ticket-pass validity for event lines is limited to `pickup_date`
     (Malaysia time).
8. **Cancellation handling**
   - An RPC applies the refund rule when a location, event or registration
     is paused, archived, rejected or withdrawn.

Each change goes through a SECURITY DEFINER RPC with a re-checked caller,
following ADR-002 and existing practice. Each migration is registered in
`canonical-history.test.ts`.

## 5. Phases (lowest risk first)

### Phase 1: Multi-location events
Additive schema. No purchasing yet.

- **Migration:** locations table, per-location registrations, backfill.
- **Admin:** manage locations inside the event editor (address, map pin,
  dates, daily hours).
  Files: `app/admin/promotion-campaigns/page.tsx`,
  `app/api/admin/promotion-campaigns/*`.
- **Vendor:** the registration form picks the location(s) to join.
  Files: `app/vendor/events/*`, `app/api/vendors/[vendorId]/campaign-registrations/*`,
  `lib/vendor/campaign-registrations.ts`.
- **Admin review:** the registration review shows the location.
  Files: `app/admin/event-registrations/*`, `lib/admin/campaign-registrations.ts`.
- **Customer:** event detail and stall pages show locations.
  Also update `get_public_promotion_campaigns`.

#### Phase 1 outcome (2026-09-30)

Migration `20260930190000_event_locations.sql`, applied live.

- **Backfill:** each existing event got one "Main location" built from its
  dates. Hours were parsed from the old text: Heritage Walk KL 10:00–22:00,
  "testing" 10:00–18:00. All 3 existing registrations were attached.
- **Integrity:**
  - A composite FK guarantees a registration's location belongs to the same
    event.
  - Uniqueness is now `(location, vendor)`.
- **Publishing:** `transition_promotion_campaign` now also requires at least
  one location to submit, approve or resume.
- **Admin:**
  - Locations are added inside the create-event form and saved just before
    publishing.
  - Each event row has a Locations panel for live events. It saves
    immediately, and the map pin reuses the map's draggable marker.
- **Public shape:** each vendor appears once, with one `stalls` entry per
  approved location, so vendor counts stay distinct. Campaigns now carry
  `locations`.
- **Deviations from the plan:**
  - **No location `status` column:** deferred to Phase 6, where pausing a
    location is needed.
  - **Optional fields:** address and map pin are optional, so the
    backfilled locations show "Address to be announced".
  - **Same-day hours only:** an overnight stall must close at 23:59 for now.
  - **Event-wide hours hidden from customers:** each location shows its own
    hours instead. The admin hours picker now only pre-fills new locations.
  - **Event window can shrink under existing locations:** editing a draft's
    dates does not re-check that its locations still fit inside them. This
    is a follow-up.
- **Verified:**
  - tsc, eslint (0 errors) and verify:i18n (100%).
  - Full vitest: only the known unrelated KYC path failure remains.
  - A rolled-back SQL smoke test run as the real admin and vendor-owner
    users.
  - All 8 affected pages return 200 on the dev server.

### Phase 2: Event listings
Still no purchasing.

- **Migration:** listing columns (kind, daily quantity, active).
- **Vendor form:** per-location listings with price and daily quantity.
  Catalog products are referenced, never copied into the catalog.

#### Phase 2 outcome (2026-09-30)
- **Migration `20260930210000_event_listings.sql`** (applied live):
  - Every listing now carries its own `price`, `item_kind`
    (product/service), `daily_quantity` (0–10,000) and `active`.
  - Existing catalog-referenced listings were backfilled with the price
    customers already saw (cheapest active outlet offer, else base price).
    Existing items start at quantity 0.
  - Submit and resubmit share one internal writer,
    `write_campaign_listings`, which no role can execute directly.
  - New `update_campaign_listing` RPC: the owner or an outlet manager can
    change quantity and on/off on pending or approved registrations.
    **Price is never editable here.**
  - The public projection now uses the listing price and hides items that
    are switched off.
- **Deviation / follow-up:** a price change after approval needs a
  resubmission, and today that is only possible from `changes_requested`.
  A vendor-initiated re-review flow is not built yet.
- **App changes:**
  - Vendor form: each item gets price, quantity per day and type inputs.
    Submit is blocked unless price ≥ 0 and quantity ≥ 1.
  - New route-local `EventListingsManager` for stock and on/off.
  - PATCH `/api/vendors/[vendorId]/campaign-listings/[listingId]`.
  - The admin detail page shows the type, quantity per day, switched-off
    items, and "Free" for RM0.
- **Verified:**
  - A rolled-back SQL smoke test confirmed:
    - negative price rejected;
    - RM0 service submitted;
    - owner update changes quantity and on/off but leaves price unchanged;
    - 20,000 per day rejected;
    - a stranger is forbidden;
    - a rejected registration is not editable.

### Phase 3: Customer events page and event-vendor presentation
Read-only.

- **Navbar:** "Events" item in `lib/customer/header-navigation.ts`.
- **Events page:** `/customer/events` gets List / Calendar / Map views over
  locations, reusing FullCalendar and MapLibre.
- **Vendor page:** event vendors get the table (product, location, date,
  time, price, reserve). Reserve is disabled until Phase 5, and says "No
  upcoming event" when the vendor isn't participating anywhere.
- **Partners page:** an "Event partners" section. Event vendors are
  excluded from all normal vendor lists and search.

#### Phase 3 outcome (2026-09-30)
- **Migration `20260930220000_vendor_kind.sql`** (applied live):
  - `vendors.kind` (`shop`/`event`, default `shop`, CHECK). All 176
    existing vendors are `shop`.
  - `get_public_promotion_campaigns` now returns `vendorKind` for each
    vendor.
  - **Deviation:** the column moved forward from Phase 4 so customer pages
    can already separate event partners. The role, portal and admin creation
    stay in Phase 4.
- **Navbar:** Home, Explore, **Events**, Partners, Trip.
- **Events page:** a List / Calendar / Map switcher.
  - Calendar: FullCalendar month and agenda views, with one all-day entry
    per location that hasn't ended.
  - Map: `MapView` pins that link to the event. Locations without a pin are
    counted below the map.
  - Both views load only when opened.
- **Event partners:**
  - Excluded from the Partners directory, home featured partners, and
    search suggestions.
  - Shown in their own "Event partners" section on Partners, with their next
    event or "No upcoming event".
  - Badged "Event partner" on event vendor cards and stall pages.
- **Vendor page:**
  - Event vendors get a dedicated layout: an "Event partner" label, the
    event items table, and no outlet or experience sections.
  - Shop vendors that are at events also get the table.
  - The table columns are item, location + event, date, time, price, and
    reserve. Reserve is disabled ("Reservations open soon") until Phase 5.
- **Helpers:** new `lib/promotion-campaigns/vendor-events.ts`
  (`vendorEventItems`, `nextVendorEvent`), with tests.
- **Not verified in a browser:** the dev server was stopped earlier for low
  memory, so page rendering still needs a manual look.

### Phase 4: Event vendor account and portal
Highest risk.

- **Account type:** `vendors.kind`, the `event_vendor` role, and the
  post-login home.
- **Portal:** its own navigation set (Events, Event items, Orders, Scanner,
  Wallet, Inbox).
- **API access:**
  - `authorizeVendor` gains an explicit allow/deny for event vendors.
  - Shop-only APIs (outlets, bookings, vouchers, catalog listings) reject
    them.
  - A contract test lists every vendor route with its event-vendor
    decision.
- **Admin:** "Create event vendor" (details + owner email) → email invite
  via `/vendor-invite` → normal approval + KYC review.

#### Phase 4 detailed plan (2026-09-30, approved)

**Sign-off decisions (2026-09-30)**
- **KYC: hard block.** Approving an event vendor is refused until the
  owner's KYC is approved.
- **Separate logins:** one login owns one vendor. A shop owner uses a
  different email for an event business.
- **Public vendor columns:** the fix for logged-out visitors reading every
  vendor column (rejection reason, approval email) is a separate task after
  Phase 4.
- **Pickup slots (changes decision 7, built in Phase 5):**
  - Replaces fixed 30-minute steps.
  - For each location it joins, a vendor defines its own time windows, of
    any length, inside the location's daily hours. They apply every day.
  - The vendor can add extra windows on specific dates.
  - Each window has a vendor-set maximum number of reservations, on top of
    the per-item daily stock.

**Confirmed facts (live DB + code, not assumptions)**
- **Roles:** they live in `roles` + `user_roles(user_id, role_id, vendor_id,
  outlet_id)`. The existing roles are super_admin, approver, vendor_owner,
  outlet_manager, customer and staff. There is no `event_vendor` yet.
- **API access:** every `/api/vendors/[vendorId]/*` route calls
  `authorizeVendor` (`lib/vendor-authorization.ts`). It grants access by
  `vendors.owner_id = auth.uid()` or an `outlet_managers` row, **not by role
  name**. So an event vendor that owns its vendor row would pass all 55
  vendor routes today, including outlets, products and vouchers. Denial must
  be explicit.
- **Portal gate:** `/vendor` pages are gated client-side only, by
  `VendorAccessGate` (`isVendorOwner` / `isOutletManager` from `/api/auth/me`).
  The navigation comes from `lib/vendor/navigation.ts`.
- **Invites:** the email invite flow (`/vendor-invite`,
  `vendor_recommendation_invites`, `claim_vendor_recommendation`) requires a
  customer recommendation (`recommendation_id` NOT NULL). Claiming always
  creates a pending vendor **plus an outlet**.
- **Vendor rows:** `vendors.owner_id` is NOT NULL, so admin cannot create the
  vendor row before the owner account exists. The row has to be created at
  claim time.
- **Approval:** `staff_review_vendor` → `admin_approve_claimed_vendor` grants
  `vendor_owner`. Approval does **not** check KYC today. KYC is per user
  (`users.kyc_status`).
- **Direct database writes:** no RLS policy lets an owner insert outlets,
  products or vouchers directly. Those writes only happen through APIs, RPCs
  or the service role, so a DB trigger covers every path.

**Design**
1. **Migration `20260930230000_event_vendor_accounts.sql`**
   - New `roles` row: `event_vendor`.
   - `vendor_recommendation_invites`:
     - `recommendation_id` becomes nullable.
     - New columns `vendor_kind` (`shop`/`event`, default `shop`) and
       `business_name`.
     - A CHECK: event invites have no recommendation but do have a business
       name; shop invites keep a recommendation.
   - New `claim_event_vendor_invite` RPC:
     - It runs the same guards as `claim_vendor_recommendation`: signed in,
       phone verified, invite active, email matches, and the owner has no
       vendor yet.
     - It creates `vendors(kind='event', status='pending')` and an onboarding
       profile, with **no outlet**.
   - `admin_approve_claimed_vendor`, for `kind='event'`:
     - It refuses unless the owner's `kyc_status = 'approved'`
       (`owner_kyc_required`).
     - It grants `event_vendor` instead of `vendor_owner`.
   - BEFORE INSERT triggers on `outlets`, `products`, `vouchers` and
     `vendor_event_promotions` refuse event vendors
     (`event_vendor_not_allowed`).
2. **Auth**
   - `Role` gains `event_vendor`.
   - Login priority: after outlet_manager, before customer.
   - Home: `/vendor/events`.
   - `use-auth` gains `isEventVendor`, which is included in `isVendor`.
3. **Portal**
   - Its own navigation set: Events, Announcements (where event invitations
     arrive) and Wallet.
   - The access gate lets event vendors reach only those pages.
   - Orders and Scanner join in Phase 5, when there is something to show.
4. **API: deny by default**
   - `authorizeVendor` also reads `vendors.kind`. Event vendors get a 403
     unless the route passes `{ allowEventVendor: true }`.
   - Opt-in routes:
     - announcements (list, read);
     - campaign-registrations (list, submit, resubmit);
     - campaign-listings;
     - the event poster/photo upload.
   - A new contract test enumerates **every** vendor route and fails if a
     route is not classified. Only the allowlist may opt in.
   - The wallet uses a separate owner-based resolver, which will be checked
     and allowed explicitly.
5. **Admin: create event vendor**
   - A "Create event vendor" action on `/admin/vendors` (business name, owner
     email, optional message) sends an event invite through the same email
     sender and `/vendor-invite` link.
   - The vendors list badges event vendors.
   - Approval uses the existing review flow and shows a clear message when
     KYC is missing.
6. **Invite wizard**
   - The resolver and preview carry `vendorKind` and `businessName`.
   - Event invites get a short claim form: business name (prefilled), legal
     name, description, phone, business address. There is no category,
     outlet name or map pin.
   - `/api/vendor/claim` picks the RPC from the invite's kind on the server,
     never from the client.
   - After claiming, the owner sees "pending review" and a link to complete
     KYC.

**Out of Phase 4:** event checkout, orders and scanner (Phase 5);
refunds (Phase 6).

#### Phase 4 outcome (2026-09-30)
- **Migration `20260930230000_event_vendor_accounts.sql`** (applied live)
  - Adds the `event_vendor` role.
  - Invites get `vendor_kind` and `business_name`, with a CHECK. Shop invites
    still require a recommendation.
  - `claim_event_vendor_invite` creates the vendor with no outlet.
  - `admin_approve_claimed_vendor` refuses event vendors with
    `owner_kyc_required` until the owner's KYC is approved, then grants
    `event_vendor`.
  - Triggers stop outlets, products, vouchers and paid event promotions from
    ever belonging to an event vendor. A vendor's `kind` can't change after
    creation.
- **Rolled-back SQL smoke test**, all as expected:
  - shop invite without a recommendation: blocked;
  - wrong email: blocked;
  - claim: an event vendor, pending, 0 outlets;
  - second claim: blocked;
  - approval without KYC: blocked;
  - approval with KYC: `event_vendor` granted;
  - creating an outlet: blocked;
  - changing the kind: blocked.
- **Access**
  - `authorizeVendor(..., { allowEventVendor: true })`. Only 8 routes opt in:
    notifications (2), announcements (2), campaign registrations (2),
    campaign listings, and the event image upload.
  - `app/api/__tests__/event-vendor-access.contract.test.ts` pins that
    allowlist and makes every vendor route that doesn't use
    `authorizeVendor` carry a written reason.
  - Behaviour tests cover the event-vendor deny and allow paths.
- **Portal**
  - Login home is `/vendor/events`.
  - The access gate allows only Events, Announcements and Wallet.
  - Navigation and the command palette show only those pages, with no shop
    actions.
  - The role label is "Event partner".
  - The event registration form hides "pick from your products".
- **Admin**
  - A "Create event vendor" dialog sends the invite email.
  - Event vendors carry a badge in the vendors list.
  - A missing KYC shows a clear approval error. This also fixes the vendors
    page showing "[object Object]" for every API error.
- **Invite flow**
  - Same wizard (account → details → phone). Event invites skip category,
    outlet and map.
  - The claim route picks the RPC from the invite's stored kind.
  - After claiming, the owner is sent to `/customer/kyc`.
- **Follow-ups**
  - Event vendors can't edit their business profile or logo yet: that route
    is owner-only and not opted in.
  - Orders and Scanner come with Phase 5.

#### Follow-up done: public vendor columns (2026-09-30)
- **Problem:** anon and authenticated users could read every column of an
  approved vendor, including `rejection_reason`, `approved_by`,
  `approval_email_*` and `platform_commission_rate`.
- **Migration `20260930240000_restrict_vendor_columns.sql`** (applied live)
  - Replaces the table-wide SELECT with column grants: `id`, `owner_id`,
    `name`, `slug`, `description`, `logo_url`, `cover_url`, `business_type`,
    `status`, `kind`, `created_at`, `updated_at`.
  - `featured_product_ids` is also granted once its pending migration
    creates the column.
  - Row rules (RLS) are unchanged.
- **Code**
  - Four user-client `select('*')` reads now list their columns: the admin
    approve and suspend routes, `/api/vendors` (GET and POST), and the
    register-vendor page.
  - `/api/vendors` GET was itself returning every column publicly.
- **Checks**
  - A dry run as anon, a signed-in user and an owner confirmed that RLS on
    outlets and products, the `public_outlet_pages` view and the public
    campaign function still work.
  - Live REST probe as anon: `rejection_reason`, `approval_email_body` and
    `select=*` are refused, while the public fields and embeds still load.
- **Regression test:** `app/api/__tests__/vendor-public-columns.contract.test.ts`
  fails if a user-client query reads a withheld column.

### Phase 5: Reservation checkout, QR, and pickup

- **Order lines:** new `order_items` columns. First, audit every query that
  reads `order_items.outlet_id` so a missing outlet is handled everywhere.
- **Checkout** (`prepare_checkout*` / `finalize_checkout`) must:
  - validate that the listing is active, the registration approved, and the
    event and location live or upcoming, and not paused or archived;
  - validate that the pickup date and slot fall within the location's
    schedule;
  - read the price from the listing on the server;
  - hold stock per listing per date under a lock;
  - send RM0 lines through the free-reservation path.
- **Reserve flow:** location → date → 30-minute slot → quantity → checkout.
- **QR:** passes for event lines are valid on the pickup date only.
  `admit_ticket_pass` checks that the date and the vendor match. The
  scanner is in the event-vendor portal.
- **Settlement and commission:** unchanged. The existing code already
  handles event lines once they carry a `vendor_id`.

#### Phase 5 detailed plan (2026-09-30, approved 2026-10-01)

**Sign-off decisions**
- **Checkout:** a separate reserve-now checkout; the cart checkout is
  unchanged.
- **Slot limit:** counts items, the same unit as daily stock.
- **Vouchers:** not usable on event reservations.
- **Delivery in two steps:**
  - 5a: slots, reserve, pay, and the customer's orders view.
  - 5b: QR codes, scanner, and the vendor Orders page.

**Confirmed facts (live DB + code)**
- **Cart checkout.** `prepare_checkout` builds orders only from `cart_items`
  (variant or booking slot). It trusts route-computed prices for paid lines
  and re-checks prices only for free lines. The route
  (`app/api/checkout/prepare/route.ts`, 558 lines) computes prices, vouchers
  and food modes, then starts the payment: wallet or wallet split, ToyyibPay,
  Stripe, or the simulator.
- **Stock holds.** `checkout_reservations` holds are `inventory | booking`.
  `finalize_checkout` releases or commits every hold generically; only
  inventory and booking holds touch counters. So a new hold kind whose stock
  is *counted from active holds* needs no change to finalize, expiry or
  failure handling.
- **Order lines.** `order_items.outlet_id` is NOT NULL. 23 app files and 8 SQL
  functions read it; most are outlet, booking or food flows.
- **Commission.** `settle_order_vendor_earnings` groups by `vendor_id` and
  never reads outlets, so the 15% commission applies unchanged.
- **QR codes.** Ticket passes require a `bookings` row, which requires a
  product `booking_slots` row, so they don't fit event pickups. Food orders
  use an HMAC token per (order, outlet), `/api/customer/orders/[id]/qr-passes`,
  scanner `resolve` and the `fulfil_food_order_group` RPC. That pattern fits
  event pickups.
- `checkout_sessions.cart_id` is NOT NULL: every checkout is tied to the
  user's cart row.

**Design (recommended)**
1. **Pickup slots.** New table `promotion_campaign_pickup_slots` with
   `registration_id`, `slot_date` (NULL = every day), `starts_at`, `ends_at`
   and `capacity`.
   - Rules: inside the location's daily hours, `slot_date` inside its date
     range, no exact duplicates.
   - Vendor RPCs to save and delete slots (owner or manager, registration
     pending or approved).
   - Vendor UI on the event page: "Every day" windows plus "Extra on a date"
     windows.
2. **Reserve-now checkout**, separate from the cart.
   - New `prepare_event_checkout(listing, pickup_date, slot, quantity,
     payment_method, idempotency_key, request_hash)` SQL function. **Inside
     SQL** it:
     - takes the price from the listing (never from the client);
     - checks the listing is active, the registration approved, and the
       event approved and not ended;
     - checks the date is inside the location's range and not in the past
       (Malaysia time), and that the slot is valid for that date;
     - locks, then checks the item's daily stock and the slot's capacity,
       both counted from active holds;
     - creates the order, payment, checkout session, order line (with event
       columns) and a hold of kind `event`;
     - treats RM0 as `free_reservation`, paid immediately.
   - A route `/api/events/checkout` runs the same capability gate (phone
     verification) as cart checkout.
   - **Payment start is extracted** from the cart route into a shared helper,
     so
     reservations use the same Stripe, ToyyibPay and wallet paths and the
     same finalize webhooks.
   - Vouchers don't apply to event reservations.
3. **Schema**
   - `order_items`:
     - `outlet_id` becomes nullable, with a CHECK that each line has either
       an outlet or an event listing;
     - adds `event_listing_id`, `event_location_id`, `pickup_date` and
       `pickup_slot_id`;
     - `slot_starts_at` carries the pickup time, reusing the existing
       displays.
   - Every reader that can meet an event line is made null-safe: customer
     orders, admin orders, refunds and vendor orders.
4. **Customer**
   - Reserve dialog on the vendor event table and stall page: date → slot
     (with remaining places) → quantity → total → pay, or confirm when RM0.
   - Event lines appear in My Orders with the location, date and time.
5. **QR and pickup**
   - Signed token per (order, vendor, location, pickup date), served by the
     existing qr-passes route.
   - A new `fulfil_event_pickup` RPC accepts it only on the pickup date
     (Malaysia time) and only for that vendor.
6. **Event vendor portal:** Orders (their event lines) and Scanner (event
   pickups, no outlet picker) join the navigation, and the matching routes
   are opted in through the event-vendor contract.

**Risks**
- **The payment-start extraction.** Existing tests cover the ToyyibPay,
  simulator and free paths (`app/api/checkout/__tests__`). The Stripe and
  wallet paths have no route tests, so they rely on a mechanical move plus a
  diff review; route tests for them will be added.
- **Null outlets in old readers:** the audited list above.
- **Overselling:** prevented by locking plus counting holds.

#### Phase 5a outcome (2026-10-01)
- **Migration `20261001090000_event_reservations.sql`** (applied live)
  - `promotion_campaign_pickup_slots`, with RLS for the vendor and staff.
  - `save_event_pickup_slot` and `delete_event_pickup_slot`. Delete is
    refused while the slot is reserved.
  - `order_items.outlet_id` is now nullable, with a CHECK for an outlet or an
    event location plus pickup date. New event columns hold the listing,
    location, date and slot.
  - Hold kind `event`.
  - `event_units_taken`, counted from active holds; not executable by users.
  - Public `get_event_pickup_availability`.
  - `prepare_event_checkout`:
    - takes the price from the listing;
    - checks the date and slot, and the daily and per-slot stock, under slot
      and listing locks;
    - treats RM0 as a free reservation;
    - snapshots "location · window" into `variant_name` so existing order
      views show it.
- **Rolled-back SQL smoke test**, all as expected:
  - out-of-hours and duplicate slots rejected, and customers can't manage
    slots;
  - availability returned;
  - a paid item can't be taken as free, and past dates are rejected;
  - total 2 × RM14 = RM28, with no outlet on the line;
  - idempotent replay returns the same checkout;
  - going over the slot limit is rejected;
  - a failed payment releases the hold and a successful one commits it;
  - settlement fee is 15% (630 of 4,200 sen);
  - a slot in use can't be deleted.
- **Live REST probe as anon:** availability works; the checkout function and
  the stock counter are refused.
- **Payment**
  - The payment start moved to `lib/checkout/start-payment.ts`. The moved
    block is byte-identical apart from two renames.
  - New Stripe and wallet-split tests were added *before* the move; all
    checkout tests pass.
  - The payment options moved to `lib/checkout/payment-choices.ts`, shared
    with the reserve dialog.
- **API**
  - `POST /api/customer/event-reservations` (capability gate, then the RPC,
    then the shared payment start).
  - `GET /api/customer/event-reservations/availability`.
  - Vendor `POST/DELETE /api/vendors/[vendorId]/pickup-slots`, opted in for
    event vendors.
- **UI**
  - The vendor event page gets a pickup-slot manager (every day plus extra
    dates, with a maximum items per slot).
  - Customers get a Reserve dialog (date, slot with places left, quantity,
    payment, or confirm when free) in the vendor event table and on stall
    pages.
  - Event lines appear in My Orders as booking-type lines with the date and
    time.
- **Known gaps for Phase 5b and Phase 6**
  - No QR code or scanner for event pickups yet (5b).
  - A customer refund of a paid reservation does not yet release its stock
    (Phase 6).
  - Existing items start at daily quantity 0 with no slots, so vendors must
    set both before customers can reserve.
- **Not browser-verified:** the dev server is still stopped.

#### Phase 5b outcome (2026-10-01)
- **Migration `20261001120000_event_pickup_fulfilment.sql`** (applied live)
  - `fulfil_event_pickup(order, vendor, location, date, operator)`, callable
    by the service role only.
  - Checks: the order is paid, the pickup date is today in Malaysia, and the
    lines belong to that vendor, location and date.
  - Marks the lines fulfilled and writes an audit log.
- **Rolled-back smoke test**, all as expected:
  - unpaid order refused;
  - tomorrow's pickup scanned today refused;
  - another vendor's lines not found;
  - fulfilled, with 1 audit row;
  - second scan refused;
  - a direct customer call denied.
- **QR code** (`lib/events/event-pickup-token.ts`)
  - HMAC token (`evt1`) per order, vendor, location and pickup date.
  - It **expires at 23:59:59 Malaysia time on the pickup date**, and
    scanning before the date is refused.
  - Tests cover the round trip, the expiry boundary and forged tokens.
- **Customer:** `qr-passes` returns `eventPickups`, and the order page shows
  one QR card per stall and date ("Valid only on …", ready or collected).
- **Scanner**
  - `scanner/resolve` recognises event pickup codes *before* the outlet
    check, so vendors without outlets can scan.
  - Every other code type still needs one of the caller's outlets.
  - New `scanner/fulfil-event-pickup` route.
  - The scanner UI gets an event-pickup review card, and event vendors get
    an outlet-free mode.
- **Reservations page:** `/vendor/event-orders` (API
  `/api/vendors/[vendorId]/event-orders`) lists paid lines by pickup date
  with collected or to-collect status. It's in the navigation for event
  vendors and shop owners.
- **Access:** the event-vendor portal now allows Reservations and Scanner,
  and the route contract has 3 more opt-ins.
- **Checks:** tsc and lint clean; full suite shows only the known KYC path
  failure.
- **Not browser-verified:** the dev server is still stopped.

### Phase 6: Cancellation and refunds

- **Triggers:** pausing or archiving an event or location, and rejecting or
  withdrawing a registration.
  - If today (Malaysia time) is before the location's start date: create
    and process refunds automatically, and reverse the settlement.
  - Otherwise: queue the refunds in `app/admin/refunds` flagged "event
    cancelled", for manual action.
- **Confirm first:** at the start of the phase, confirm the real (non-simulated)
  payment-refund path per provider (Stripe / ToyyibPay / wallet).

#### Phase 6 detailed plan (2026-10-01, approved)

**Sign-off decisions (2026-10-01)**
- **Refund cutoff:** the **whole event's start**
  (`promotion_campaigns.starts_at`). Cancellations before it refund
  automatically; from then on they go to the admin queue.
- **Pause keeps reservations.** Only cancellations refund.
- **All four cancellation actions:** cancel the event (archive), cancel a
  location, vendor withdraws, admin removes a vendor.
- **Go-ahead given** for service-role processing of queued wallet refunds.

**Confirmed facts (live DB + code)**
- **Refunds today:** `refunds(pending|approved|rejected|processed)`. The
  customer requests a **full-order** refund
  (`app/api/orders/[orderId]/refund`); a super admin approves in
  `/admin/refunds` (`app/api/admin/refunds/[refundId]`).
- **Per-method behaviour of that approve route:**
  - **wallet:** `process_wallet_refund`. Requires a super-admin session and
    `pending` status; full refunds only.
  - **simulators:** `begin_simulated_refund`.
  - **Stripe card:** `stripe.refunds.create` with an idempotency key.
  - **ToyyibPay / bank transfer:** only marked "processed". **No money
    moves**, because there is no provider refund call.
  - **wallet_split:** the whole order total is refunded to Stripe although
    only the card part was charged. This is a pre-existing bug.
- **Stock:** no refund path releases event stock today. A refunded
  reservation keeps its places taken.
- **Campaign transitions:** pause, resume and archive exist. Locations have no
  status. Registrations can't be withdrawn once approved.
- **Order shape:** every event order holds exactly one reservation line
  (reserve-now checkout), so a full-order refund equals a reservation refund.

**Design (recommended)**
1. **Stock follows refunds, whichever path.** A trigger on
   `orders.status → refunded/cancelled` releases that order's event holds and
   cancels its uncollected event lines. This covers admin, wallet, simulator
   and future refund paths.
2. **Cancellation actions.** Each calls one SQL function,
   `cancel_event_reservations(scope, id, reason)`:
   - Admin cancels a whole event (archive).
   - Admin cancels one location (new location `status = cancelled`).
   - Vendor withdraws from a location (new registration status
     `withdrawn`).
   - Admin removes a vendor from a location.
3. **What the function does for each affected paid, uncollected
   reservation:**
   - **Free (RM0):** the line is cancelled and the stock released; there is
     nothing to refund.
   - **Before that location's start date (Malaysia time):** a refund is
     queued as `approved` and processed automatically.
   - **On or after the start date:** a refund is created as `pending`, marked
     "event cancelled", for an admin to handle in `/admin/refunds`.
4. **Automatic processing.**
   - The approve branch of the admin route moves into
     `lib/refunds/process-refund.ts` so admin and automatic processing share
     it.
   - Right after a cancellation, and again from a cron sweep for retries,
     `approved` event refunds are processed for **card, wallet and the
     simulators only**.
   - ToyyibPay, bank transfer and wallet split fall back to the admin queue,
     since no safe automatic refund exists for them.
   - `process_wallet_refund` gains service-role access and accepts
     `approved` refunds. This is a narrow permission change on a money
     function.
5. **Customers** see "Cancelled by the organiser — refund in progress" on the
   reservation. The pickup QR stops working once the line is cancelled.

**Out of scope:** fixing the wallet-split refund bug and ToyyibPay refunds.
Both stay manual and are flagged to admin.

#### Phase 6 outcome (2026-10-01)
- **Migration `20261001150000_event_cancellations.sql`** (applied live after
  a rolled-back dry run)
  - Location `status` (active or cancelled), with a reason.
  - Registration statuses `withdrawn` and `removed`, with `closed_reason`.
  - `refunds.auto_process`.
  - A trigger on orders: when an order becomes refunded or cancelled, its
    event places are released and its uncollected lines cancelled.
  - `cancel_event_reservations` (internal, no user grants).
  - Cascade triggers: archiving an event cancels its reservations; cancelling
    a location removes its stalls; closing an approved stall cancels its
    reservations.
  - New registrations at a cancelled location are refused.
  - RPCs `cancel_promotion_campaign_location` and
    `close_campaign_registration` (withdraw by the vendor, remove by admin).
  - `process_wallet_refund` now also accepts the service role.
  - Cancelled locations are hidden from the public projection.
- **Dry-run smoke test**, all as expected:
  - vendor withdraws after the start: 2 manual refunds, the free order
    cancelled, holds released;
  - location cancelled before the start: 2 automatic refunds, the location
    hidden, new registrations blocked;
  - archive cancels the reservations;
  - a refunded order frees its places;
  - customers are refused every action; the service role passes the wallet
    refund's permission check.
- **App**
  - `lib/refunds/process-refund.ts` is shared by the admin refund route and
    automatic processing. Automatic refunds use `providerRefundOnly`, so they
    can **never** be marked processed without a real provider refund.
  - `lib/refunds/process-queued-event-refunds.ts` runs right after each
    cancellation and every 5 minutes from
    `/api/cron/process-event-refunds`. A refund that can't be automated is
    handed to the admin queue with its failure code.
  - Routes: admin location cancel, admin remove vendor, vendor withdraw. The
    archive action triggers refund processing.
  - UI: "Cancel location" in the admin location editor, "Remove from
    location" on admin registration detail, "Withdraw from this location" on
    the vendor event page.
- **Behaviour change (intended):** approving a refund no longer erases its
  reason when the admin leaves the note empty.
- **Checks:** tsc and lint clean on touched files; full suite shows only the
  known KYC path failure.
- **Not browser-verified.**
- **Still manual by design:**
  - ToyyibPay and bank transfer have no refund API.
  - The wallet + card refund bug is unchanged.

## 6. Risks

1. **The event-vendor role (Phase 4): highest risk.**
   - **Blast radius:** 52 routes use `authorizeVendor`; 48 files check
     `vendor_owner`/`outlet_manager` by name; 49 RLS policies rely on owner
     or outlet-manager checks.
   - **Failure modes:** a missed route is either a broken page or a
     permission leak.
   - **Mitigation:**
     - Event vendors stay `vendors` rows (`kind = 'event'`, `owner_id` set,
       no outlets), so owner-based RLS, wallet and settlement keep working.
     - The route contract test forces an explicit decision per route.
     - Pages that assume an outlet are hidden from event vendors.
2. **Making `order_items.outlet_id` nullable (Phase 5).**
   - Vendor order lists, outlet-manager scoping and reports join outlets.
   - **Mitigation:** audit first; handle null everywhere before relaxing the
     constraint.
3. **Overselling and price tampering (Phase 5).**
   - **Mitigation:** daily capacity checked under a row lock; the price is
     always read from the listing on the server; concurrency and
     price-integrity tests.
4. **Backfilling existing registrations to a default location (Phase 1).**
   - Live data: Heritage Walk KL (2 approved vendors) and "testing".
   - **Mitigation:** an idempotent migration, with row counts verified
     before and after.
5. **Refunds on real payment providers (Phase 6).**
   - The simulated refund path exists, but the real provider refund path
     must be confirmed before automatic refunds go live.

## 7. Files NOT touched

- Catalog products/variants/inventory and outlet offers (except read-only
  references from listings).
- `vendor_event_promotions` and all of admin/vendor "Event Promos".
- Sponsored placements, affiliate and recommendation commissions.
- The settlement and commission SQL (reused unchanged).

## 8. New dependencies

None. `maplibre-gl` and `@fullcalendar/*` are already installed.

## 9. Verification (per phase)

- **Automated checks:** `npx tsc --noEmit`, `npm run lint`,
  `npm run verify:i18n` (en/ms/zh-CN), affected `vitest` suites, and a full
  suite at the end of each phase.
- **Migrations:** applied live, then signatures and constraints checked via
  `pg_proc` / `information_schema`, and registered in
  `canonical-history.test.ts`.
- **New tests:**
  - Phase 1: location backfill counts.
  - Phase 4: the event-vendor route allow/deny contract.
  - Phase 5: checkout price integrity, the concurrent last-unit
    reservation, pickup slot validation, QR valid only on the pickup date.
  - Phase 6: auto vs. manual refund decided by the location's start date.
- **Live smoke test per phase:**
  - admin creates a location;
  - vendor joins a location;
  - customer reserves (location → date → slot) and pays;
  - QR scans on the pickup date and is rejected on another date;
  - pausing a future location auto-refunds.
