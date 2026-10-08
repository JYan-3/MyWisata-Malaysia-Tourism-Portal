-- Event management protections. Keep installed ownership/payment checks and
-- public -> app_private wrappers; patch the installed transaction bodies.
CREATE SCHEMA IF NOT EXISTS app_private;
-- Existing public read wrappers may require anon USAGE. Preserve installed
-- schema access; each new helper has its own explicit EXECUTE revocation.
REVOKE CREATE ON SCHEMA app_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.lock_event_campaign(p_campaign_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_campaign_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('event-management:' || p_campaign_id::text, 0));
  END IF;
END; $$;
REVOKE ALL ON FUNCTION app_private.lock_event_campaign(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app_private.assert_event_location_open(p_location_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.promotion_campaign_locations%ROWTYPE; c public.promotion_campaigns%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=p_location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_location_not_found'; END IF;
  PERFORM app_private.lock_event_campaign(l.campaign_id);
  -- Re-read after waiting: the organiser may have cancelled or changed it.
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=p_location_id;
  SELECT * INTO c FROM public.promotion_campaigns WHERE id=l.campaign_id;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'promotion_campaign_location_cancelled'; END IF;
  IF (l.ends_on+l.closes_at) AT TIME ZONE 'Asia/Kuala_Lumpur' <= now() THEN
    RAISE EXCEPTION 'promotion_campaign_location_ended';
  END IF;
  IF c.status <> 'approved' OR c.ends_at <= now() THEN RAISE EXCEPTION 'campaign_not_open'; END IF;
END; $$;
REVOKE ALL ON FUNCTION app_private.assert_event_location_open(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app_private.event_location_change_impact(
  p_location_id UUID,p_address TEXT,p_lat DOUBLE PRECISION,p_lng DOUBLE PRECISION,
  p_starts_on DATE,p_ends_on DATE,p_opens_at TIME,p_closes_at TIME)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.promotion_campaign_locations%ROWTYPE; v_reservations INTEGER; v_slots INTEGER; v_vendors INTEGER;
  v_moved BOOLEAN;
BEGIN
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=p_location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_location_not_found'; END IF;
  v_moved := (l.address,l.lat,l.lng) IS DISTINCT FROM (NULLIF(btrim(p_address),''),p_lat,p_lng);
  SELECT count(DISTINCT r.vendor_id)::integer INTO v_vendors FROM public.promotion_campaign_vendors r
    WHERE r.event_location_id=p_location_id AND r.status IN ('pending','approved');
  SELECT count(*)::integer INTO v_slots FROM public.promotion_campaign_pickup_slots s
    JOIN public.promotion_campaign_vendors r ON r.id=s.registration_id
    WHERE r.event_location_id=p_location_id AND r.status IN ('pending','approved')
      AND (s.slot_date IS NULL OR s.slot_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date)
      AND (s.starts_at<p_opens_at OR s.ends_at>p_closes_at
        OR (s.slot_date IS NOT NULL AND (s.slot_date<p_starts_on OR s.slot_date>p_ends_on)));
  SELECT count(DISTINCT affected.order_id)::integer INTO v_reservations FROM (
    SELECT oi.order_id FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
      LEFT JOIN public.promotion_campaign_pickup_slots s ON s.id=oi.pickup_slot_id
      WHERE oi.event_location_id=p_location_id AND oi.fulfil_status IN ('pending','ready')
        AND lower(o.status) IN ('paid','completed')
        AND oi.pickup_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
        AND (v_moved OR oi.pickup_date<p_starts_on OR oi.pickup_date>p_ends_on
          OR s.starts_at<p_opens_at OR s.ends_at>p_closes_at)
    UNION ALL
    SELECT cs.order_id FROM public.checkout_reservations cr
      JOIN public.checkout_sessions cs ON cs.id=cr.checkout_session_id
      JOIN public.promotion_campaign_pickup_slots s ON s.id=cr.pickup_slot_id
      JOIN public.promotion_campaign_vendors r ON r.id=s.registration_id
      WHERE r.event_location_id=p_location_id AND cr.kind='event' AND cr.status='held'
        AND cs.status IN ('pending_payment','requires_action') AND cs.expires_at>now()
        AND (v_moved OR cr.pickup_date<p_starts_on OR cr.pickup_date>p_ends_on
          OR s.starts_at<p_opens_at OR s.ends_at>p_closes_at)
  ) affected;
  RETURN jsonb_build_object('locationUpdatedAt',l.updated_at,'affectedReservations',v_reservations,
    'affectedVendors',v_vendors,'incompatibleSlots',v_slots,'blockingReasons',
    CASE WHEN v_reservations>0 THEN jsonb_build_array('LOCATION_CHANGE_HAS_RESERVATIONS')
         WHEN v_slots>0 THEN jsonb_build_array('LOCATION_CHANGE_HAS_SLOTS') ELSE '[]'::jsonb END);
END; $$;
REVOKE ALL ON FUNCTION app_private.event_location_change_impact(UUID,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,DATE,DATE,TIME,TIME) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app_private.guard_event_location_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE impact JSONB;
BEGIN
  IF (NEW.name,NEW.address,NEW.lat,NEW.lng,NEW.starts_on,NEW.ends_on,NEW.opens_at,NEW.closes_at)
     IS NOT DISTINCT FROM (OLD.name,OLD.address,OLD.lat,OLD.lng,OLD.starts_on,OLD.ends_on,OLD.opens_at,OLD.closes_at) THEN RETURN NEW; END IF;
  IF OLD.status <> 'active' THEN RAISE EXCEPTION 'promotion_campaign_location_cancelled'; END IF;
  IF (OLD.ends_on+OLD.closes_at) AT TIME ZONE 'Asia/Kuala_Lumpur' <= now() THEN
    RAISE EXCEPTION 'promotion_campaign_location_ended';
  END IF;
  impact := app_private.event_location_change_impact(OLD.id,NEW.address,NEW.lat,NEW.lng,
    NEW.starts_on,NEW.ends_on,NEW.opens_at,NEW.closes_at);
  IF (impact->>'affectedReservations')::integer>0 THEN RAISE EXCEPTION 'location_change_has_reservations'; END IF;
  IF (impact->>'incompatibleSlots')::integer>0 THEN RAISE EXCEPTION 'location_change_has_slots'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.guard_event_location_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_location_commitment_guard BEFORE UPDATE ON public.promotion_campaign_locations
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_event_location_change();

CREATE OR REPLACE FUNCTION app_private.guard_event_campaign_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF (NEW.starts_at,NEW.ends_at) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at) AND EXISTS (
    SELECT 1 FROM public.promotion_campaign_locations l WHERE l.campaign_id=NEW.id AND l.status='active'
      AND (l.starts_on<(NEW.starts_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
        OR l.ends_on>(NEW.ends_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date)
  ) THEN RAISE EXCEPTION 'locations_outside_event'; END IF;
  IF NEW.status IN ('pending_approval','approved') AND NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
    SELECT 1 FROM public.promotion_campaign_locations l WHERE l.campaign_id=NEW.id AND l.status='active'
      AND (l.ends_on+l.closes_at) AT TIME ZONE 'Asia/Kuala_Lumpur'>now()
  ) THEN RAISE EXCEPTION 'no_active_location'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.guard_event_campaign_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_campaign_validity_guard BEFORE UPDATE ON public.promotion_campaigns
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_event_campaign_change();

-- Patch only installed PL/pgSQL bodies. Invoker API wrappers stay intact, and
-- a guest checkout core receives the same lock/validity checks as account use.
DO $patch$
DECLARE f RECORD; src TEXT; updated TEXT; prelude TEXT; v_checkout_count INTEGER:=0;
BEGIN
  FOR f IN SELECT p.oid,p.proname,n.nspname FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname IN ('public','app_private') AND l.lanname='plpgsql' AND p.proname IN (
      'save_promotion_campaign_location','save_promotion_campaign_draft','transition_promotion_campaign',
      'delete_promotion_campaign_location','cancel_promotion_campaign_location','close_campaign_registration',
      'submit_campaign_vendor_registration','resubmit_campaign_vendor_registration','review_campaign_vendor_registration',
      'save_event_pickup_slot','delete_event_pickup_slot','prepare_event_checkout','event_checkout_transaction_core')
  LOOP
    src:=pg_get_functiondef(f.oid); updated:=src;
    CASE
    WHEN f.proname IN ('save_promotion_campaign_location','save_promotion_campaign_draft','transition_promotion_campaign') THEN
      prelude:='PERFORM app_private.lock_event_campaign(p_campaign_id);';
    WHEN f.proname IN ('delete_promotion_campaign_location','cancel_promotion_campaign_location') THEN
      prelude:='PERFORM app_private.lock_event_campaign((SELECT campaign_id FROM public.promotion_campaign_locations WHERE id=p_location_id));';
    WHEN f.proname='submit_campaign_vendor_registration' THEN
      prelude:='PERFORM app_private.assert_event_location_open(p_location_id);';
    WHEN f.proname IN ('resubmit_campaign_vendor_registration','save_event_pickup_slot') THEN
      prelude:='PERFORM app_private.assert_event_location_open((SELECT event_location_id FROM public.promotion_campaign_vendors WHERE id=p_registration_id));';
    WHEN f.proname IN ('review_campaign_vendor_registration','close_campaign_registration') THEN
      prelude:='PERFORM app_private.lock_event_campaign((SELECT campaign_id FROM public.promotion_campaign_vendors WHERE id=p_registration_id));';
      IF f.proname='review_campaign_vendor_registration' THEN
        prelude:=prelude||E'\n IF p_action=''approve'' THEN PERFORM app_private.assert_event_location_open((SELECT event_location_id FROM public.promotion_campaign_vendors WHERE id=p_registration_id)); END IF;';
      END IF;
    WHEN f.proname='delete_event_pickup_slot' THEN
      prelude:='PERFORM app_private.lock_event_campaign((SELECT r.campaign_id FROM public.promotion_campaign_pickup_slots s JOIN public.promotion_campaign_vendors r ON r.id=s.registration_id WHERE s.id=p_slot_id));';
    ELSE
      IF f.proname='prepare_event_checkout' AND position('event_checkout_transaction_core' IN src)>0 THEN
        -- Guest migration's PL/pgSQL owner wrapper delegates to this core.
        -- Its ownership/capability checks must remain intact.
        CONTINUE;
      END IF;
      -- Preserve idempotent reads of previous checkouts; guard new holds only.
      IF position('-- Lock order: slot, then listing' IN src)=0 THEN
        RAISE EXCEPTION 'event_checkout_guard_preflight_required: %.%',f.nspname,f.proname;
      END IF;
      updated:=replace(src,'-- Lock order: slot, then listing',
        E'PERFORM app_private.assert_event_location_open((SELECT r.event_location_id FROM public.promotion_campaign_vendor_products vp JOIN public.promotion_campaign_vendors r ON r.id=vp.registration_id WHERE vp.id=p_listing_id));\n  -- Lock order: slot, then listing');
      updated:=replace(updated,'IF (v_slot.slot_date IS NOT NULL',
        'IF v_slot.starts_at < v_location.opens_at OR v_slot.ends_at > v_location.closes_at OR (v_slot.slot_date IS NOT NULL');
      IF updated=src OR position('v_slot.starts_at < v_location.opens_at' IN updated)=0 THEN RAISE EXCEPTION 'event_checkout_hours_preflight_required'; END IF;
      EXECUTE updated; v_checkout_count:=v_checkout_count+1; CONTINUE;
    END CASE;
    updated:=regexp_replace(src,E'\nBEGIN\n',E'\nBEGIN\n  '||prelude||E'\n','i');
    IF updated=src THEN RAISE EXCEPTION 'event_management_guard_preflight_required: %.%',f.nspname,f.proname; END IF;
    IF f.proname='save_promotion_campaign_location' THEN
      updated:=replace(updated,'v_before := to_jsonb(v_location);',
        E'IF (v_location.name,v_location.address,v_location.lat,v_location.lng,v_location.starts_on,v_location.ends_on,v_location.opens_at,v_location.closes_at) IS NOT DISTINCT FROM (btrim(p_name),NULLIF(btrim(p_address),''''),p_lat,p_lng,p_starts_on,p_ends_on,p_opens_at,p_closes_at) THEN RETURN to_jsonb(v_location); END IF;\n    v_before := to_jsonb(v_location);');
    END IF;
    EXECUTE updated;
  END LOOP;
  IF v_checkout_count=0 THEN RAISE EXCEPTION 'event_checkout_transaction_not_found'; END IF;
END; $patch$;

-- Retain the installed projection's product/price resolution and grants.
DO $projection$
DECLARE f RECORD; src TEXT; updated TEXT;
BEGIN
  SELECT p.oid INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang WHERE p.proname='get_public_promotion_campaigns'
    AND n.nspname IN ('public','app_private') AND l.lanname='plpgsql';
  IF f.oid IS NULL THEN RAISE EXCEPTION 'event_public_projection_not_found'; END IF;
  src:=pg_get_functiondef(f.oid);
  updated:=replace(src,'AND campaign.ends_at > now()',
    'AND campaign.ends_at > now() AND EXISTS (SELECT 1 FROM public.promotion_campaign_locations active_location WHERE active_location.campaign_id=campaign.id AND active_location.status=''active'' AND (active_location.ends_on+active_location.closes_at) AT TIME ZONE ''Asia/Kuala_Lumpur''>now())');
  updated:=replace(updated,'''locations'', v_locations,',
    '''operationalStatus'', CASE WHEN EXISTS (SELECT 1 FROM public.promotion_campaign_locations live_location WHERE live_location.campaign_id=v_campaign.id AND live_location.status=''active'' AND (now() AT TIME ZONE ''Asia/Kuala_Lumpur'')::date BETWEEN live_location.starts_on AND live_location.ends_on AND (now() AT TIME ZONE ''Asia/Kuala_Lumpur'')::time >= live_location.opens_at AND (now() AT TIME ZONE ''Asia/Kuala_Lumpur'')::time < live_location.closes_at) THEN ''operating'' WHEN NOT EXISTS (SELECT 1 FROM public.promotion_campaign_locations started_location WHERE started_location.campaign_id=v_campaign.id AND started_location.status=''active'' AND (started_location.starts_on+started_location.opens_at) AT TIME ZONE ''Asia/Kuala_Lumpur''<=now()) THEN ''upcoming'' ELSE ''between_sessions'' END, ''locations'', v_locations,');
  IF updated=src OR position('''operationalStatus''' IN updated)=0 THEN RAISE EXCEPTION 'event_public_projection_preflight_required'; END IF;
  EXECUTE updated;
END; $projection$;

NOTIFY pgrst,'reload schema';
