-- Removes the demo pop-up events created by scripts/seed-demo-popup-events.sql.
-- Plan: Docs/plans/2026-10-15-1650-demo-popup-event-variations.md
-- Refuses if any order or checkout reservation references them, since deleting
-- would break order history; deal with those orders first.

BEGIN;

DO $$
DECLARE refs integer;
BEGIN
  SELECT count(*) INTO refs FROM public.order_items oi
   WHERE oi.event_location_id IN (SELECT l.id FROM public.promotion_campaign_locations l
                                    JOIN public.promotion_campaigns c ON c.id = l.campaign_id
                                   WHERE c.slug IN ('demo-popup-fiesta', 'demo-coming-soon-market'));
  IF refs > 0 THEN
    RAISE EXCEPTION 'demo events have % order item(s); resolve those orders before removing', refs;
  END IF;
END $$;

DELETE FROM public.promotion_campaigns
 WHERE slug IN ('demo-popup-fiesta', 'demo-coming-soon-market')
RETURNING slug;

COMMIT;
