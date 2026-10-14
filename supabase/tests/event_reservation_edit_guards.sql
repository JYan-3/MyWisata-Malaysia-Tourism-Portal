-- Run inside a rollback transaction after event-management seed/guards.
DO $$ DECLARE err text; BEGIN
  UPDATE public.checkout_reservations SET status='committed' WHERE kind='event';
  BEGIN
    UPDATE public.promotion_campaign_pickup_slots SET starts_at=starts_at+interval '1 minute'
      WHERE id='88888888-8888-4888-8888-888888888888';
  EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
  IF err IS DISTINCT FROM 'event_slot_has_commitments' THEN
    RAISE EXCEPTION 'in-use slot edit was not protected: %',err;
  END IF;
  err:=NULL;
  BEGIN
    UPDATE public.promotion_campaign_vendor_products SET daily_quantity=0
      WHERE id='77777777-7777-4777-8777-777777777777';
  EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
  IF err IS DISTINCT FROM 'event_stock_below_commitments' THEN
    RAISE EXCEPTION 'in-use stock shrink was not protected: %',err;
  END IF;
  UPDATE public.checkout_reservations SET status='released' WHERE kind='event';
  IF public.event_units_taken('77777777-7777-4777-8777-777777777777',NULL,'2026-10-10')<1 THEN RAISE EXCEPTION 'collected consumption disappeared after release'; END IF;
END $$;
