-- Serialize edits with the same campaign lock used by new reservations.
CREATE OR REPLACE FUNCTION app_private.guard_event_reservation_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE campaign uuid; used integer;
BEGIN
  SELECT r.campaign_id INTO campaign FROM public.promotion_campaign_vendors r WHERE r.id=OLD.registration_id;
  PERFORM app_private.lock_event_campaign(campaign);
  IF TG_TABLE_NAME='promotion_campaign_pickup_slots' THEN
    SELECT coalesce(max(n),0) INTO used FROM (
      SELECT cr.pickup_date,public.event_units_taken(NULL,OLD.id,cr.pickup_date) n
      FROM public.checkout_reservations cr WHERE cr.pickup_slot_id=OLD.id GROUP BY cr.pickup_date
    ) counts;
    IF used>0 AND (NEW.registration_id,NEW.slot_date,NEW.starts_at,NEW.ends_at) IS DISTINCT FROM (OLD.registration_id,OLD.slot_date,OLD.starts_at,OLD.ends_at) THEN
      RAISE EXCEPTION 'event_slot_has_commitments';
    END IF;
    IF NEW.capacity<used THEN RAISE EXCEPTION 'event_capacity_below_commitments'; END IF;
  ELSE
    SELECT coalesce(max(n),0) INTO used FROM (
      SELECT cr.pickup_date,public.event_units_taken(OLD.id,NULL,cr.pickup_date) n
      FROM public.checkout_reservations cr WHERE cr.event_listing_id=OLD.id GROUP BY cr.pickup_date
    ) counts;
    IF NEW.daily_quantity<used THEN RAISE EXCEPTION 'event_stock_below_commitments'; END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.guard_event_reservation_edit() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_pickup_commitment_guard BEFORE UPDATE ON public.promotion_campaign_pickup_slots
FOR EACH ROW EXECUTE FUNCTION app_private.guard_event_reservation_edit();
CREATE TRIGGER event_stock_commitment_guard BEFORE UPDATE ON public.promotion_campaign_vendor_products
FOR EACH ROW EXECUTE FUNCTION app_private.guard_event_reservation_edit();
-- The owner RPC must acquire the campaign lock before locking the listing row.
DO $patch$ DECLARE f record; src text; changed text; BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('public','app_private')
    AND p.proname='update_campaign_listing' AND l.lanname='plpgsql'
  LOOP
    src:=replace(pg_get_functiondef(f.oid),E'\r','');
    IF position('promotion_campaign_vendors' IN src)=0 OR position('forbidden' IN src)=0 OR position('p_listing_id' IN src)=0 THEN RAISE EXCEPTION 'listing_guard_preflight_required'; END IF;
    changed:=regexp_replace(src,E'\nBEGIN\n',E'\nBEGIN\n PERFORM app_private.lock_event_campaign((SELECT r.campaign_id FROM public.promotion_campaign_vendor_products p JOIN public.promotion_campaign_vendors r ON r.id=p.registration_id WHERE p.id=p_listing_id));\n');
    IF changed=src THEN RAISE EXCEPTION 'listing_guard_patch_failed'; END IF;
    EXECUTE changed;
  END LOOP;
END; $patch$;
CREATE TABLE public.event_listing_closed_dates(
 listing_id uuid NOT NULL REFERENCES public.promotion_campaign_vendor_products(id),pickup_date date NOT NULL,
 reason text NOT NULL,closed_by uuid NOT NULL REFERENCES public.users(id),closed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(listing_id,pickup_date)
);
ALTER TABLE public.event_listing_closed_dates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_listing_closed_dates FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_listing_closed_dates TO service_role;
CREATE FUNCTION public.resolve_event_shortage(p_listing uuid,p_date date,p_reason text,p_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE campaign uuid; reg uuid; impact jsonb; evidence jsonb; result jsonb; BEGIN
 IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN RAISE EXCEPTION 'permission_denied'; END IF;
 SELECT r.campaign_id,r.id INTO campaign,reg FROM public.promotion_campaign_vendor_products vp JOIN public.promotion_campaign_vendors r ON r.id=vp.registration_id WHERE vp.id=p_listing;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
 PERFORM app_private.lock_event_campaign(campaign);
 IF p_date IS NULL OR p_date<(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN RAISE EXCEPTION 'event_shortage_date_invalid'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'status',o.status,'updatedAt',o.updated_at,'quantity',oi.quantity,'amount',o.total_amount,'fulfilled',oi.fulfil_status,'sessionStatus',cs.status,'expiresAt',cs.expires_at) ORDER BY o.id),'[]'::jsonb)
 INTO evidence FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
 JOIN public.checkout_sessions cs ON cs.order_id=o.id
 WHERE oi.event_listing_id=p_listing AND oi.pickup_date=p_date AND oi.fulfil_status IN ('pending','ready')
 AND lower(o.status) IN ('paid','completed','pending_payment')
 AND NOT EXISTS(SELECT 1 FROM public.order_items other WHERE other.order_id=o.id AND (other.event_listing_id IS DISTINCT FROM p_listing OR other.pickup_date IS DISTINCT FROM p_date OR other.fulfil_status='fulfilled'));
 SELECT jsonb_build_object('orders',count(DISTINCT o.id),'units',coalesce(sum(oi.quantity),0),'amountSen',coalesce(sum(CASE WHEN lower(o.status) IN ('paid','completed') THEN round(o.total_amount*100)::bigint ELSE 0 END),0),
 'vendors',CASE WHEN count(*)>0 THEN 1 ELSE 0 END,'version',md5(evidence::text||coalesce((SELECT closed_at::text FROM public.event_listing_closed_dates WHERE listing_id=p_listing AND pickup_date=p_date),'')))
 INTO impact FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE o.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(evidence) x);
 IF p_version IS NULL THEN RETURN impact; END IF;
 IF p_version IS DISTINCT FROM impact->>'version' THEN RAISE EXCEPTION 'event_shortage_changed'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'event_shortage_reason_required'; END IF;
 INSERT INTO public.event_listing_closed_dates(listing_id,pickup_date,reason,closed_by) VALUES(p_listing,p_date,btrim(p_reason),auth.uid()) ON CONFLICT DO NOTHING;
 PERFORM set_config('mywisata.shortage_listing',p_listing::text,true);
 PERFORM set_config('mywisata.shortage_date',p_date::text,true);
 result:=public.cancel_event_reservations(NULL,NULL,reg,p_reason);
 PERFORM set_config('mywisata.shortage_listing','',true);PERFORM set_config('mywisata.shortage_date','',true);
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,after_data,note) VALUES(auth.uid(),'event_shortage.resolved','event_listing',p_listing,impact||jsonb_build_object('date',p_date),p_reason);
 RETURN impact||result;
END; $$;
REVOKE ALL ON FUNCTION public.resolve_event_shortage(uuid,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_event_shortage(uuid,date,text,text) TO authenticated;

DO $patch$ DECLARE f record; src text; changed text; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN ('public','app_private') AND l.lanname='plpgsql' AND p.proname IN ('event_checkout_transaction_core','prepare_event_checkout','cancel_event_reservations','cancel_pending_event_checkouts') LOOP
 src:=replace(pg_get_functiondef(f.oid),E'\r','');changed:=src;
 IF f.proname IN ('event_checkout_transaction_core','prepare_event_checkout') THEN
  IF position('-- Lock order: slot, then listing' IN src)=0 THEN CONTINUE; END IF;
  changed:=replace(src,'-- Lock order: slot, then listing',E'IF EXISTS(SELECT 1 FROM public.event_listing_closed_dates WHERE listing_id=p_listing_id AND pickup_date=p_pickup_date) THEN RAISE EXCEPTION ''event_item_unavailable''; END IF;\n -- Lock order: slot, then listing');
 ELSE
  IF position('WHERE oi.event_location_id IS NOT NULL' IN src)>0 THEN
   changed:=replace(src,'WHERE oi.event_location_id IS NOT NULL',E'WHERE (nullif(current_setting(''mywisata.shortage_listing'',true),'''') IS NULL OR (oi.event_listing_id=nullif(current_setting(''mywisata.shortage_listing'',true),'''')::uuid AND oi.pickup_date=nullif(current_setting(''mywisata.shortage_date'',true),'''')::date AND NOT EXISTS(SELECT 1 FROM public.order_items other WHERE other.order_id=oi.order_id AND (other.event_listing_id IS DISTINCT FROM oi.event_listing_id OR other.pickup_date IS DISTINCT FROM oi.pickup_date OR other.fulfil_status=''fulfilled'')))) AND oi.event_location_id IS NOT NULL');
  ELSIF f.proname='cancel_pending_event_checkouts' THEN
   changed:=replace(src,'WHERE cs.status IN',E'WHERE (nullif(current_setting(''mywisata.shortage_listing'',true),'''') IS NULL OR (oi.event_listing_id=nullif(current_setting(''mywisata.shortage_listing'',true),'''')::uuid AND oi.pickup_date=nullif(current_setting(''mywisata.shortage_date'',true),'''')::date)) AND cs.status IN');
  END IF;
 END IF;
 IF changed<>src THEN EXECUTE changed; END IF;
 END LOOP;
END; $patch$;
-- Collected units remain consumed even when an after-pickup refund releases
-- the reservation. Replenishing goods is a separate, explicit stock decision.
DO $patch$ DECLARE f record; src text; changed text; n integer:=0; BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','app_private') AND p.proname='event_units_taken' LOOP
 src:=replace(pg_get_functiondef(f.oid),E'\r','');
 changed:=replace(src,'r.status = ''committed'' OR', 'r.status = ''committed'' OR EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=s.order_id AND oi.event_listing_id=r.event_listing_id AND oi.pickup_slot_id=r.pickup_slot_id AND oi.pickup_date=r.pickup_date AND oi.fulfil_status=''fulfilled'') OR');
 IF changed=src THEN RAISE EXCEPTION 'event_units_preflight_required'; END IF;
 EXECUTE changed;n:=n+1;
 END LOOP;
 IF n<>1 THEN RAISE EXCEPTION 'event_units_installation_required'; END IF;
END; $patch$;
