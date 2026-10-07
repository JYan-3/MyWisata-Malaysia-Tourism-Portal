-- Confirmed allocation and intake controls extend the existing event lifecycle.
-- Never silently renumber approved vendors during migration.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.promotion_campaign_vendors WHERE status='approved'
    GROUP BY event_location_id,lower(btrim(stall_number)) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'event_approved_stall_conflicts_require_admin_resolution';
  END IF;
END; $$;

ALTER TABLE public.promotion_campaign_vendors
  ADD COLUMN requested_stall_number text,
  ALTER COLUMN stall_number DROP NOT NULL;
UPDATE public.promotion_campaign_vendors SET requested_stall_number=nullif(btrim(stall_number),''),stall_number=NULL
  WHERE status IN ('pending','changes_requested');
ALTER TABLE public.promotion_campaign_vendors
  ADD CONSTRAINT event_confirmed_stall_required CHECK(status<>'approved' OR nullif(btrim(stall_number),'') IS NOT NULL),
  ADD CONSTRAINT event_pending_stall_unassigned CHECK(status NOT IN ('pending','changes_requested') OR stall_number IS NULL),
  ADD CONSTRAINT event_requested_stall_length CHECK(requested_stall_number IS NULL OR char_length(btrim(requested_stall_number)) BETWEEN 1 AND 40);
CREATE UNIQUE INDEX event_confirmed_stall_unique ON public.promotion_campaign_vendors
  (event_location_id,lower(btrim(stall_number))) WHERE status='approved';
REVOKE INSERT,UPDATE,DELETE ON public.promotion_campaign_vendors FROM anon,authenticated,service_role;

ALTER TABLE public.promotion_campaign_locations
  ADD COLUMN max_stalls integer CHECK(max_stalls>0),
  ADD COLUMN applications_open boolean NOT NULL DEFAULT false,
  ADD COLUMN applications_close_at timestamptz,
  ADD COLUMN approvals_close_at timestamptz,
  ADD COLUMN setup_starts_at timestamptz,
  ADD CONSTRAINT event_intake_schedule CHECK(
    (NOT applications_open AND applications_close_at IS NULL AND approvals_close_at IS NULL AND setup_starts_at IS NULL)
    OR (applications_close_at IS NOT NULL AND approvals_close_at IS NOT NULL AND setup_starts_at IS NOT NULL
      AND applications_close_at<=approvals_close_at AND approvals_close_at<=setup_starts_at
      AND setup_starts_at<(starts_on+opens_at) AT TIME ZONE 'Asia/Kuala_Lumpur'));

CREATE OR REPLACE FUNCTION app_private.guard_event_location_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE occupied integer;
BEGIN
  PERFORM app_private.lock_event_campaign(NEW.campaign_id);
  IF (NEW.max_stalls IS NOT NULL AND NEW.max_stalls<=0) OR
    ((NEW.applications_open OR NEW.applications_close_at IS NOT NULL OR NEW.approvals_close_at IS NOT NULL OR NEW.setup_starts_at IS NOT NULL)
      AND (NEW.applications_close_at IS NULL OR NEW.approvals_close_at IS NULL OR NEW.setup_starts_at IS NULL
        OR NEW.applications_close_at>NEW.approvals_close_at OR NEW.approvals_close_at>NEW.setup_starts_at
        OR NEW.setup_starts_at>=(NEW.starts_on+NEW.opens_at) AT TIME ZONE 'Asia/Kuala_Lumpur')) THEN
    RAISE EXCEPTION 'event_intake_schedule_invalid';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.max_stalls,NEW.applications_open,NEW.applications_close_at,NEW.approvals_close_at,NEW.setup_starts_at)
    IS DISTINCT FROM (OLD.max_stalls,OLD.applications_open,OLD.applications_close_at,OLD.approvals_close_at,OLD.setup_starts_at) THEN
    IF OLD.status<>'active' THEN RAISE EXCEPTION 'promotion_campaign_location_cancelled'; END IF;
    IF (OLD.ends_on+OLD.closes_at) AT TIME ZONE 'Asia/Kuala_Lumpur'<=clock_timestamp() THEN RAISE EXCEPTION 'promotion_campaign_location_ended'; END IF;
    IF (NEW.applications_open AND NOT OLD.applications_open)
      OR NEW.applications_close_at>OLD.applications_close_at OR NEW.approvals_close_at>OLD.approvals_close_at THEN
      IF OLD.setup_starts_at IS NOT NULL AND OLD.setup_starts_at<=clock_timestamp() THEN RAISE EXCEPTION 'event_setup_started'; END IF;
    END IF;
    IF ((NEW.applications_open AND NOT OLD.applications_open) OR NEW.applications_close_at>OLD.applications_close_at
      OR NEW.approvals_close_at>OLD.approvals_close_at
      OR EXISTS(SELECT 1 FROM public.promotion_campaign_vendors WHERE event_location_id=NEW.id AND status IN ('pending','approved','changes_requested')))
      AND char_length(coalesce(nullif(btrim(current_setting('mywisata.event_change_reason',true)),''),'')) NOT BETWEEN 5 AND 500 THEN
      RAISE EXCEPTION 'event_change_reason_required';
    END IF;
    SELECT count(*) INTO occupied FROM public.promotion_campaign_vendors WHERE event_location_id=NEW.id AND status='approved';
    IF NEW.max_stalls IS NULL AND OLD.max_stalls IS NOT NULL AND occupied>0 THEN RAISE EXCEPTION 'event_capacity_below_occupied'; END IF;
    IF NEW.max_stalls<occupied THEN RAISE EXCEPTION 'event_capacity_below_occupied'; END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.guard_event_location_allocation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_location_allocation_guard BEFORE INSERT OR UPDATE ON public.promotion_campaign_locations
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_event_location_allocation();

CREATE OR REPLACE FUNCTION app_private.guard_event_booth_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.promotion_campaign_locations%ROWTYPE; occupied integer; changed_assignment boolean;
BEGIN
  PERFORM app_private.lock_event_campaign(NEW.campaign_id);
  IF TG_OP='UPDATE' AND (NEW.campaign_id,NEW.event_location_id,NEW.vendor_id,NEW.submitted_by)
    IS DISTINCT FROM (OLD.campaign_id,OLD.event_location_id,OLD.vendor_id,OLD.submitted_by) THEN RAISE EXCEPTION 'event_registration_identity_immutable'; END IF;
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=NEW.event_location_id AND campaign_id=NEW.campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_location_not_found'; END IF;
  IF TG_OP='INSERT' OR (NEW.status='pending' AND OLD.status='changes_requested') THEN
    PERFORM app_private.assert_event_location_open(l.id);
    IF TG_OP='INSERT' THEN
      IF NOT l.applications_open OR l.applications_close_at IS NULL OR l.applications_close_at<=clock_timestamp() THEN RAISE EXCEPTION 'event_applications_closed'; END IF;
    ELSE
      IF l.approvals_close_at IS NULL OR l.approvals_close_at<=clock_timestamp() THEN RAISE EXCEPTION 'event_approvals_closed'; END IF;
    END IF;
    -- Preserve legacy RPC arguments as a preference; only review assigns a booth.
    NEW.requested_stall_number:=nullif(btrim(NEW.stall_number),'');
    NEW.stall_number:=NULL;
  END IF;
  IF NEW.status IN ('pending','changes_requested') THEN NEW.stall_number:=NULL; END IF;
  IF TG_OP='UPDATE' AND NEW.status='changes_requested' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN RAISE EXCEPTION 'admin_required'; END IF;
    PERFORM app_private.assert_event_location_open(l.id);
    IF l.approvals_close_at IS NULL OR l.approvals_close_at<=clock_timestamp() THEN RAISE EXCEPTION 'event_approvals_closed'; END IF;
  END IF;
  IF NEW.status='approved' THEN
    changed_assignment:=TG_OP='INSERT' OR OLD.status<>'approved' OR OLD.stall_number IS DISTINCT FROM NEW.stall_number;
    IF changed_assignment THEN
      IF NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN RAISE EXCEPTION 'admin_required'; END IF;
      IF nullif(btrim(NEW.stall_number),'') IS NULL OR char_length(btrim(NEW.stall_number))>40 THEN RAISE EXCEPTION 'invalid_stall_number'; END IF;
      NEW.stall_number:=btrim(NEW.stall_number);
      IF TG_OP='INSERT' OR OLD.status<>'approved' THEN
        PERFORM app_private.assert_event_location_open(l.id);
        IF l.approvals_close_at IS NULL OR l.approvals_close_at<=clock_timestamp() THEN RAISE EXCEPTION 'event_approvals_closed'; END IF;
        IF l.max_stalls IS NULL THEN RAISE EXCEPTION 'event_capacity_unconfirmed'; END IF;
        SELECT count(*) INTO occupied FROM public.promotion_campaign_vendors WHERE event_location_id=l.id AND status='approved' AND id<>NEW.id;
        IF occupied>=l.max_stalls THEN RAISE EXCEPTION 'event_capacity_full'; END IF;
      ELSE
        IF l.status<>'active' THEN RAISE EXCEPTION 'promotion_campaign_location_cancelled'; END IF;
        IF (l.ends_on+l.closes_at) AT TIME ZONE 'Asia/Kuala_Lumpur'<=clock_timestamp() THEN RAISE EXCEPTION 'promotion_campaign_location_ended'; END IF;
        IF char_length(coalesce(btrim(current_setting('mywisata.event_change_reason',true)),'')) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'event_change_reason_required'; END IF;
      END IF;
      IF EXISTS(SELECT 1 FROM public.promotion_campaign_vendors WHERE event_location_id=l.id AND status='approved'
        AND id<>NEW.id AND lower(btrim(stall_number))=lower(NEW.stall_number)) THEN RAISE EXCEPTION 'event_stall_conflict'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.guard_event_booth_registration() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_booth_registration_guard BEFORE INSERT OR UPDATE ON public.promotion_campaign_vendors
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_event_booth_registration();

-- Preserve installed ownership/listing checks, including public/private layouts.
DO $patch$ DECLARE f record; src text; updated text; patched integer:=0;
BEGIN
  FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language lang ON lang.oid=p.prolang WHERE n.nspname IN ('public','app_private') AND lang.lanname='plpgsql'
    AND p.proname IN ('submit_campaign_vendor_registration','resubmit_campaign_vendor_registration') LOOP
    src:=pg_get_functiondef(f.oid);
    updated:=replace(src,'char_length(btrim(COALESCE(p_stall_number, ''''))) NOT BETWEEN 1 AND 40',
      'char_length(btrim(COALESCE(p_stall_number, ''''))) > 40');
    IF src=updated THEN RAISE EXCEPTION 'event_registration_preference_preflight_required'; END IF;
    EXECUTE updated; patched:=patched+1;
  END LOOP;
  IF patched<>2 THEN RAISE EXCEPTION 'event_registration_preference_functions_missing'; END IF;
END; $patch$;

CREATE OR REPLACE FUNCTION app_private.event_location_intake(p_location_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('maxStalls',l.max_stalls,'occupiedStalls',a.occupied,
    'remainingStalls',CASE WHEN l.max_stalls IS NULL THEN NULL ELSE greatest(0,l.max_stalls-a.occupied) END,
    'applicationsOpen',l.applications_open AND l.applications_close_at>now() AND l.status='active',
    'applicationsCloseAt',l.applications_close_at,'approvalsCloseAt',l.approvals_close_at,'setupStartsAt',l.setup_starts_at)
  FROM public.promotion_campaign_locations l CROSS JOIN LATERAL
    (SELECT count(*)::integer occupied FROM public.promotion_campaign_vendors WHERE event_location_id=l.id AND status='approved') a WHERE l.id=p_location_id;
$$;
REVOKE ALL ON FUNCTION app_private.event_location_intake(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Extend only the installed location projection; retain product/price logic.
DO $projection$ DECLARE f record; src text; updated text;
BEGIN
  SELECT p.oid INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language lang ON lang.oid=p.prolang
    WHERE n.nspname IN ('public','app_private') AND lang.lanname='plpgsql' AND p.proname='get_public_promotion_campaigns';
  src:=pg_get_functiondef(f.oid);
  updated:=replace(src,'''closesAt'', to_char(l.closes_at, ''HH24:MI'')',
    '''closesAt'', to_char(l.closes_at, ''HH24:MI''), ''intake'', app_private.event_location_intake(l.id)');
  IF src=updated THEN RAISE EXCEPTION 'event_intake_projection_preflight_required'; END IF;
  EXECUTE updated;
END; $projection$;

-- Reuse the owner-only queue, sanitization and durable event keys.
DO $notice$ DECLARE src text; updated text;
BEGIN
  src:=pg_get_functiondef('app_private.queue_event_vendor_change_notice(uuid,uuid,jsonb)'::regprocedure);
  updated:=replace(src,'''eventTitle'',app_private.event_notice_display_text(p_details->>''eventTitle'')',
    '''kind'',coalesce(p_details->>''kind'',''arrangement''),''eventTitle'',app_private.event_notice_display_text(p_details->>''eventTitle'')');
  updated:=replace(updated,'WHEN ''closesAt'' THEN ''Closing time'' END',
    'WHEN ''closesAt'' THEN ''Closing time'' WHEN ''applicationsOpen'' THEN ''Applications open'' WHEN ''applicationsCloseAt'' THEN ''Applications close'' WHEN ''approvalsCloseAt'' THEN ''Approvals close'' WHEN ''setupStartsAt'' THEN ''Setup starts'' END');
  updated:=replace(updated,'''vendor_event_update'',''Your event arrangements changed'',',
    '''vendor_event_update'',CASE WHEN v_details->>''kind''=''approval'' THEN ''Your event participation is approved'' ELSE ''Your event arrangements changed'' END,');
  IF updated=src OR position('''kind''' IN updated)=0 THEN RAISE EXCEPTION 'event_notice_preflight_required'; END IF;
  EXECUTE updated;
END; $notice$;

CREATE OR REPLACE FUNCTION app_private.notify_event_booth_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.promotion_campaign_locations%ROWTYPE; title text; change_id uuid; reason text; kind text;
BEGIN
  IF NEW.status<>'approved' OR (OLD.status='approved' AND NEW.stall_number IS NOT DISTINCT FROM OLD.stall_number) THEN RETURN NEW; END IF;
  kind:=CASE WHEN OLD.status<>'approved' THEN 'approval' ELSE 'arrangement' END;
  reason:=CASE WHEN kind='approval' THEN 'Your participation and confirmed booth have been approved.'
    ELSE nullif(btrim(current_setting('mywisata.event_change_reason',true)),'') END;
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=NEW.event_location_id;
  SELECT c.title INTO title FROM public.promotion_campaigns c WHERE c.id=NEW.campaign_id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,note)
    VALUES(auth.uid(),CASE WHEN kind='approval' THEN 'promotion_campaign_vendor.approved' ELSE 'promotion_campaign_vendor.stall_changed' END,
      'promotion_campaign_vendor',NEW.id,to_jsonb(OLD),to_jsonb(NEW),reason) RETURNING id INTO change_id;
  PERFORM app_private.queue_event_vendor_change_notice(NEW.id,change_id,jsonb_build_object('kind',kind,'eventTitle',title,
    'locationName',l.name,'startsOn',l.starts_on,'endsOn',l.ends_on,'reason',reason,
    'changes',jsonb_build_array(jsonb_build_object('field','stallNumber','before',coalesce(OLD.stall_number,''),'after',NEW.stall_number))));
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.notify_event_booth_assignment() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_booth_assignment_notice AFTER UPDATE ON public.promotion_campaign_vendors
  FOR EACH ROW EXECUTE FUNCTION app_private.notify_event_booth_assignment();

CREATE OR REPLACE FUNCTION app_private.change_campaign_vendor_stall(
  p_registration_id uuid,p_expected_updated_at timestamptz,p_stall_number text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.promotion_campaign_vendors%ROWTYPE; changed boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN RAISE EXCEPTION 'promotion_campaign_permission_required'; END IF;
  IF nullif(btrim(p_stall_number),'') IS NULL OR char_length(btrim(p_stall_number))>40 THEN RAISE EXCEPTION 'invalid_stall_number'; END IF;
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id=p_registration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM app_private.lock_event_campaign(r.campaign_id);
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id=p_registration_id FOR UPDATE;
  IF r.status<>'approved' THEN RAISE EXCEPTION 'not_editable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.promotion_campaigns WHERE id=r.campaign_id AND status IN ('approved','paused') AND ends_at>clock_timestamp()) THEN RAISE EXCEPTION 'campaign_not_open'; END IF;
  IF p_expected_updated_at IS NULL OR r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'event_change_stale'; END IF;
  changed:=lower(btrim(r.stall_number))<>lower(btrim(p_stall_number));
  IF NOT changed THEN RETURN jsonb_build_object('stallNumber',r.stall_number,'updatedAt',r.updated_at,'notificationQueued',false); END IF;
  PERFORM set_config('mywisata.event_change_reason',coalesce(btrim(p_reason),''),true);
  UPDATE public.promotion_campaign_vendors SET stall_number=btrim(p_stall_number),updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  PERFORM set_config('mywisata.event_change_reason','',true);
  RETURN jsonb_build_object('stallNumber',r.stall_number,'updatedAt',r.updated_at,'notificationQueued',true);
END; $$;

CREATE OR REPLACE FUNCTION app_private.review_campaign_vendor_registration_with_stall(
  p_registration_id uuid,p_action text,p_note text,p_expected_updated_at timestamptz,p_stall_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.promotion_campaign_vendors%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve','reject','request_changes') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id=p_registration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM app_private.lock_event_campaign(r.campaign_id);
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id=p_registration_id FOR UPDATE;
  IF r.status<>'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;
  IF p_action='approve' THEN
    IF p_expected_updated_at IS NULL OR r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'event_change_stale'; END IF;
    UPDATE public.promotion_campaign_vendors SET stall_number=nullif(btrim(p_stall_number),''),status='approved',
      reviewer_id=auth.uid(),reviewed_at=clock_timestamp(),rejection_reason=NULL,changes_requested_reason=NULL,
      changes_requested_at=NULL,updated_at=clock_timestamp() WHERE id=r.id;
    INSERT INTO public.promotion_campaign_vendor_review_events(registration_id,from_status,to_status,action,actor_id,actor_role,note)
      VALUES(r.id,'pending','approved','approve',auth.uid(),'admin',p_note);
  ELSE
    PERFORM public.review_campaign_vendor_registration(r.id,p_action,p_note);
  END IF;
  RETURN jsonb_build_object('ok',true,'notificationQueued',p_action='approve');
END; $$;
CREATE OR REPLACE FUNCTION public.review_campaign_vendor_registration_with_stall(
  p_registration_id uuid,p_action text,p_note text,p_expected_updated_at timestamptz,p_stall_number text)
RETURNS jsonb LANGUAGE sql SET search_path=public,pg_temp AS $$
  SELECT app_private.review_campaign_vendor_registration_with_stall(p_registration_id,p_action,p_note,p_expected_updated_at,p_stall_number);
$$;
REVOKE ALL ON FUNCTION app_private.review_campaign_vendor_registration_with_stall(uuid,text,text,timestamptz,text),
  public.review_campaign_vendor_registration_with_stall(uuid,text,text,timestamptz,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.review_campaign_vendor_registration_with_stall(uuid,text,text,timestamptz,text),
  public.review_campaign_vendor_registration_with_stall(uuid,text,text,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.notify_event_location_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE base_changes jsonb; intake_changes jsonb; all_changes jsonb; reason text; change_id uuid; title text; r record;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('field',field,'before',before_value,'after',after_value)),'[]'::jsonb)
    INTO base_changes FROM (VALUES ('name',OLD.name,NEW.name),('address',coalesce(OLD.address,''),coalesce(NEW.address,'')),
      ('mapPin',coalesce(OLD.lat::text||', '||OLD.lng::text,''),coalesce(NEW.lat::text||', '||NEW.lng::text,'')),
      ('startsOn',OLD.starts_on::text,NEW.starts_on::text),('endsOn',OLD.ends_on::text,NEW.ends_on::text),
      ('opensAt',to_char(OLD.opens_at,'HH24:MI'),to_char(NEW.opens_at,'HH24:MI')),('closesAt',to_char(OLD.closes_at,'HH24:MI'),to_char(NEW.closes_at,'HH24:MI')),
      ('setupStartsAt',coalesce(to_char(OLD.setup_starts_at AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI'),''),coalesce(to_char(NEW.setup_starts_at AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI'),'')))
    changes(field,before_value,after_value) WHERE before_value IS DISTINCT FROM after_value;
  SELECT coalesce(jsonb_agg(jsonb_build_object('field',field,'before',before_value,'after',after_value)),'[]'::jsonb)
    INTO intake_changes FROM (VALUES ('applicationsOpen',OLD.applications_open::text,NEW.applications_open::text),
      ('applicationsCloseAt',coalesce(to_char(OLD.applications_close_at AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI'),''),coalesce(to_char(NEW.applications_close_at AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI'),'')),
      ('approvalsCloseAt',coalesce(to_char(OLD.approvals_close_at AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI'),''),coalesce(to_char(NEW.approvals_close_at AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI'),'')))
    changes(field,before_value,after_value) WHERE before_value IS DISTINCT FROM after_value;
  IF jsonb_array_length(base_changes||intake_changes)=0 THEN RETURN NEW; END IF;
  SELECT c.title INTO title FROM public.promotion_campaigns c WHERE c.id=NEW.campaign_id;
  reason:=nullif(btrim(current_setting('mywisata.event_change_reason',true)),'');
  FOR r IN SELECT id,status FROM public.promotion_campaign_vendors WHERE event_location_id=NEW.id
    AND status IN ('pending','approved','changes_requested') LOOP
    all_changes:=base_changes||CASE WHEN r.status IN ('pending','changes_requested') THEN intake_changes ELSE '[]'::jsonb END;
    IF jsonb_array_length(all_changes)=0 THEN CONTINUE; END IF;
    IF reason IS NULL OR char_length(reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'event_change_reason_required'; END IF;
    IF change_id IS NULL THEN
      INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,note)
        VALUES(auth.uid(),'promotion_campaign_location.arrangements_changed','promotion_campaign_location',NEW.id,to_jsonb(OLD),to_jsonb(NEW),reason) RETURNING id INTO change_id;
    END IF;
    PERFORM app_private.queue_event_vendor_change_notice(r.id,change_id,jsonb_build_object('eventTitle',title,'locationName',NEW.name,
      'startsOn',NEW.starts_on,'endsOn',NEW.ends_on,'changes',all_changes,'reason',reason));
  END LOOP;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION app_private.event_location_input(
  p_current public.promotion_campaign_locations,p_input jsonb)
RETURNS public.promotion_campaign_locations LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE next_location public.promotion_campaign_locations:=p_current;
BEGIN
  next_location.name:=btrim(p_input->>'name'); next_location.address:=nullif(btrim(p_input->>'address'),'');
  next_location.lat:=(p_input->>'lat')::double precision; next_location.lng:=(p_input->>'lng')::double precision;
  next_location.starts_on:=(p_input->>'startsOn')::date; next_location.ends_on:=(p_input->>'endsOn')::date;
  next_location.opens_at:=(p_input->>'opensAt')::time; next_location.closes_at:=(p_input->>'closesAt')::time;
  IF p_input ? 'maxStalls' THEN next_location.max_stalls:=(p_input->>'maxStalls')::integer; END IF;
  IF p_input ? 'applicationsOpen' THEN next_location.applications_open:=(p_input->>'applicationsOpen')::boolean; END IF;
  IF p_input ? 'applicationsCloseAt' THEN next_location.applications_close_at:=(p_input->>'applicationsCloseAt')::timestamptz; END IF;
  IF p_input ? 'approvalsCloseAt' THEN next_location.approvals_close_at:=(p_input->>'approvalsCloseAt')::timestamptz; END IF;
  IF p_input ? 'setupStartsAt' THEN next_location.setup_starts_at:=(p_input->>'setupStartsAt')::timestamptz; END IF;
  IF next_location.name IS NULL OR char_length(next_location.name) NOT BETWEEN 2 AND 120
    OR (next_location.address IS NOT NULL AND char_length(next_location.address) NOT BETWEEN 3 AND 300)
    OR (next_location.lat IS NULL)<>(next_location.lng IS NULL)
    OR next_location.lat NOT BETWEEN -90 AND 90 OR next_location.lng NOT BETWEEN -180 AND 180
    OR next_location.starts_on IS NULL OR next_location.ends_on IS NULL OR next_location.ends_on<next_location.starts_on
    OR next_location.opens_at IS NULL OR next_location.closes_at IS NULL OR next_location.closes_at<=next_location.opens_at THEN
    RAISE EXCEPTION 'promotion_campaign_location_invalid';
  END IF;
  RETURN next_location;
END; $$;
REVOKE ALL ON FUNCTION app_private.event_location_input(public.promotion_campaign_locations,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app_private.preview_promotion_campaign_location_change(
  p_campaign_id uuid,p_location_id uuid,p_input jsonb,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.promotion_campaign_locations%ROWTYPE; n public.promotion_campaign_locations%ROWTYPE;
  impact jsonb; layout_changed boolean; setup_changed boolean; intake_changed boolean; affected integer; require_reason boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN RAISE EXCEPTION 'promotion_campaign_permission_required'; END IF;
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=p_location_id AND campaign_id=p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_location_not_found'; END IF;
  IF l.status<>'active' THEN RAISE EXCEPTION 'promotion_campaign_location_cancelled'; END IF;
  IF p_expected_updated_at IS NULL OR l.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'event_change_stale'; END IF;
  n:=app_private.event_location_input(l,p_input);
  impact:=app_private.event_location_change_impact(l.id,n.address,n.lat,n.lng,n.starts_on,n.ends_on,n.opens_at,n.closes_at);
  layout_changed:=(l.name,l.address,l.lat,l.lng,l.starts_on,l.ends_on,l.opens_at,l.closes_at)
    IS DISTINCT FROM (n.name,n.address,n.lat,n.lng,n.starts_on,n.ends_on,n.opens_at,n.closes_at);
  setup_changed:=l.setup_starts_at IS DISTINCT FROM n.setup_starts_at;
  intake_changed:=(l.applications_open,l.applications_close_at,l.approvals_close_at)
    IS DISTINCT FROM (n.applications_open,n.applications_close_at,n.approvals_close_at);
  SELECT count(DISTINCT vendor_id) INTO affected FROM public.promotion_campaign_vendors WHERE event_location_id=l.id
    AND ((status IN ('pending','approved','changes_requested') AND (layout_changed OR setup_changed))
      OR (status IN ('pending','changes_requested') AND intake_changed));
  require_reason:=affected>0 OR (((n.max_stalls IS DISTINCT FROM l.max_stalls) OR intake_changed OR setup_changed) AND EXISTS(
    SELECT 1 FROM public.promotion_campaign_vendors WHERE event_location_id=l.id AND status IN ('pending','approved','changes_requested')))
    OR (n.applications_open AND NOT l.applications_open) OR n.applications_close_at>l.applications_close_at OR n.approvals_close_at>l.approvals_close_at;
  RETURN impact||jsonb_build_object('affectedVendors',affected,'requiresReason',coalesce(require_reason,false));
END; $$;

CREATE OR REPLACE FUNCTION app_private.save_promotion_campaign_location_protected(
  p_campaign_id uuid,p_location_id uuid,p_input jsonb,p_expected_updated_at timestamptz,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.promotion_campaign_locations%ROWTYPE; n public.promotion_campaign_locations%ROWTYPE;
  c public.promotion_campaigns%ROWTYPE; before_row jsonb; preview jsonb; queued boolean:=false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN RAISE EXCEPTION 'promotion_campaign_permission_required'; END IF;
  PERFORM app_private.lock_event_campaign(p_campaign_id);
  SELECT * INTO c FROM public.promotion_campaigns WHERE id=p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_not_found'; END IF;
  IF c.status='archived' THEN RAISE EXCEPTION 'promotion_campaign_invalid_transition'; END IF;
  IF p_location_id IS NOT NULL THEN
    SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=p_location_id AND campaign_id=p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_location_not_found'; END IF;
    preview:=app_private.preview_promotion_campaign_location_change(p_campaign_id,p_location_id,p_input,p_expected_updated_at);
    queued:=(preview->>'affectedVendors')::integer>0;
    before_row:=to_jsonb(l);
  ELSE
    l.id:=gen_random_uuid(); l.campaign_id:=p_campaign_id; l.applications_open:=false; l.status:='active';
  END IF;
  n:=app_private.event_location_input(l,p_input);
  IF n.starts_on<(c.starts_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date OR n.ends_on>(c.ends_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN RAISE EXCEPTION 'promotion_campaign_location_outside_event'; END IF;
  IF p_location_id IS NOT NULL AND (l.name,l.address,l.lat,l.lng,l.starts_on,l.ends_on,l.opens_at,l.closes_at,l.max_stalls,l.applications_open,l.applications_close_at,l.approvals_close_at,l.setup_starts_at)
    IS NOT DISTINCT FROM (n.name,n.address,n.lat,n.lng,n.starts_on,n.ends_on,n.opens_at,n.closes_at,n.max_stalls,n.applications_open,n.applications_close_at,n.approvals_close_at,n.setup_starts_at) THEN
    RETURN to_jsonb(l)||jsonb_build_object('notificationQueued',false);
  END IF;
  PERFORM set_config('mywisata.event_change_reason',coalesce(btrim(p_reason),''),true);
  IF p_location_id IS NULL THEN
    INSERT INTO public.promotion_campaign_locations(id,campaign_id,name,address,lat,lng,starts_on,ends_on,opens_at,closes_at,
      max_stalls,applications_open,applications_close_at,approvals_close_at,setup_starts_at)
      VALUES(n.id,p_campaign_id,n.name,n.address,n.lat,n.lng,n.starts_on,n.ends_on,n.opens_at,n.closes_at,
        n.max_stalls,n.applications_open,n.applications_close_at,n.approvals_close_at,n.setup_starts_at) RETURNING * INTO n;
  ELSE
    UPDATE public.promotion_campaign_locations SET name=n.name,address=n.address,lat=n.lat,lng=n.lng,
      starts_on=n.starts_on,ends_on=n.ends_on,opens_at=n.opens_at,closes_at=n.closes_at,max_stalls=n.max_stalls,
      applications_open=n.applications_open,applications_close_at=n.applications_close_at,approvals_close_at=n.approvals_close_at,
      setup_starts_at=n.setup_starts_at,updated_at=clock_timestamp() WHERE id=l.id RETURNING * INTO n;
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,note)
    VALUES(auth.uid(),'promotion_campaign_location.save','promotion_campaign_location',n.id,before_row,to_jsonb(n),p_reason);
  PERFORM set_config('mywisata.event_change_reason','',true);
  RETURN to_jsonb(n)||jsonb_build_object('notificationQueued',queued);
END; $$;

NOTIFY pgrst,'reload schema';
