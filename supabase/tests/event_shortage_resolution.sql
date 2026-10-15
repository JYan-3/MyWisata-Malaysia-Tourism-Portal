SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
DO $$ DECLARE p jsonb; err text; BEGIN
 UPDATE public.order_items SET fulfil_status='pending',fulfilled_at=NULL WHERE order_id='aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
 p:=public.resolve_event_shortage('77777777-7777-4777-8777-777777777777','2026-10-10','Confirmed fixture shortage',NULL);
 IF p->>'version' IS NULL THEN RAISE EXCEPTION 'shortage impact not versioned'; END IF;
 BEGIN PERFORM public.resolve_event_shortage('77777777-7777-4777-8777-777777777777','2026-10-10','Confirmed fixture shortage','stale'); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'event_shortage_changed' THEN RAISE EXCEPTION 'stale shortage accepted: %',err; END IF;
 p:=public.resolve_event_shortage('77777777-7777-4777-8777-777777777777','2026-10-10','Confirmed fixture shortage',p->>'version');
 IF NOT EXISTS(SELECT 1 FROM public.event_listing_closed_dates WHERE listing_id='77777777-7777-4777-8777-777777777777' AND pickup_date='2026-10-10') THEN RAISE EXCEPTION 'shortage did not close new sales'; END IF;
 IF EXISTS(SELECT 1 FROM public.order_items WHERE order_id='aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1' AND fulfil_status IN ('pending','ready')) THEN RAISE EXCEPTION 'shortage left affected fulfilment open'; END IF;
 IF EXISTS(SELECT 1 FROM public.order_items WHERE fulfil_status='cancelled' AND event_listing_id='77777777-7777-4777-8777-777777777777' AND pickup_date<>'2026-10-10') THEN RAISE EXCEPTION 'shortage cancelled another date'; END IF;
END $$;
