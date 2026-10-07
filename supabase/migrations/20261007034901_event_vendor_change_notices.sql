-- Queue changes and their notices atomically. Keep every installed email type.
DO $$
DECLARE expression TEXT;
BEGIN
  SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint
    WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_event_type_check';
  IF expression IS NULL THEN RAISE EXCEPTION 'email_outbox_constraint_preflight_required'; END IF;
  ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
  EXECUTE 'ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_event_type_check CHECK (('
    ||expression||') OR event_type=''vendor_event_update'')';
END; $$;

CREATE OR REPLACE FUNCTION app_private.event_notice_display_text(value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(coalesce(value,''),
    '\m[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\M','[redacted]','gi'),
    '(https?://[^[:space:]]+/storage/[^[:space:]]+|(/Users/|/var/|/tmp/)[^[:space:]]+)','[redacted]','gi'),
    '\m(sk|rk|pk|pi|ch|cs|cus|acct|tok|whsec)_[A-Za-z0-9_-]+\M','[redacted]','g');
$$;
REVOKE ALL ON FUNCTION app_private.event_notice_display_text(TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app_private.queue_event_vendor_change_notice(
  p_registration_id UUID,p_change_id UUID,p_details JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE recipient RECORD; v_key TEXT; v_details JSONB; v_changes JSONB; v_body TEXT;
BEGIN
  SELECT v.owner_id,u.email,u.full_name,v.name INTO recipient
    FROM public.promotion_campaign_vendors r JOIN public.vendors v ON v.id=r.vendor_id
    JOIN public.users u ON u.id=v.owner_id
    WHERE r.id=p_registration_id AND v.status='approved';
  IF NOT FOUND OR nullif(btrim(recipient.email),'') IS NULL THEN
    RAISE EXCEPTION 'vendor_notice_recipient_unavailable';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('field',item->>'field',
    'before',app_private.event_notice_display_text(item->>'before'),
    'after',app_private.event_notice_display_text(item->>'after'))),'[]'::jsonb)
    INTO v_changes FROM jsonb_array_elements(p_details->'changes') item;
  v_details:=jsonb_build_object('eventTitle',app_private.event_notice_display_text(p_details->>'eventTitle'),
    'locationName',app_private.event_notice_display_text(p_details->>'locationName'),
    'startsOn',p_details->>'startsOn','endsOn',p_details->>'endsOn','changes',v_changes,
    'reason',app_private.event_notice_display_text(p_details->>'reason'),'actionPath','/vendor/events');
  SELECT string_agg(CASE item->>'field' WHEN 'stallNumber' THEN 'Stall' WHEN 'name' THEN 'Venue name'
    WHEN 'address' THEN 'Address' WHEN 'mapPin' THEN 'Map pin' WHEN 'startsOn' THEN 'First date'
    WHEN 'endsOn' THEN 'Last date' WHEN 'opensAt' THEN 'Opening time' WHEN 'closesAt' THEN 'Closing time' END
    ||': '||(item->>'before')||' → '||(item->>'after'),'; ') INTO v_body FROM jsonb_array_elements(v_changes) item;
  v_body:=format('%s · %s · %s–%s. %s. Reason: %s',v_details->>'eventTitle',v_details->>'locationName',
    v_details->>'startsOn',v_details->>'endsOn',v_body,v_details->>'reason');
  v_key:='vendor_event_update:'||p_change_id::text||':'||p_registration_id::text||':'||recipient.owner_id::text;
  INSERT INTO public.notifications(user_id,vendor_id,audience_role,type,title,body,link,category,metadata,event_key)
    SELECT recipient.owner_id,r.vendor_id,'vendor_owner','vendor_event_update','Your event arrangements changed',
      v_body,'/vendor/events','vendor_account',v_details,v_key FROM public.promotion_campaign_vendors r WHERE r.id=p_registration_id
    ON CONFLICT(event_key) DO NOTHING;
  INSERT INTO public.email_outbox(event_key,user_id,to_email,event_type,payload,status)
    VALUES(v_key,recipient.owner_id,recipient.email,'vendor_event_update',
      jsonb_build_object('recipientName',app_private.event_notice_display_text(recipient.full_name),
        'vendorName',app_private.event_notice_display_text(recipient.name),'reason',v_details->>'reason',
        'occurredAt',clock_timestamp(),'eventChange',v_details),'pending')
    ON CONFLICT(event_key) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION app_private.queue_event_vendor_change_notice(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app_private.notify_event_location_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_changes JSONB; v_details JSONB; v_reason TEXT; v_change UUID; r RECORD;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('field',field,'before',before_value,'after',after_value)),'[]'::jsonb)
    INTO v_changes FROM (VALUES
      ('name',OLD.name,NEW.name),('address',coalesce(OLD.address,''),coalesce(NEW.address,'')),
      ('mapPin',coalesce(OLD.lat::text||', '||OLD.lng::text,''),coalesce(NEW.lat::text||', '||NEW.lng::text,'')),
      ('startsOn',OLD.starts_on::text,NEW.starts_on::text),('endsOn',OLD.ends_on::text,NEW.ends_on::text),
      ('opensAt',to_char(OLD.opens_at,'HH24:MI'),to_char(NEW.opens_at,'HH24:MI')),
      ('closesAt',to_char(OLD.closes_at,'HH24:MI'),to_char(NEW.closes_at,'HH24:MI'))
    ) changes(field,before_value,after_value) WHERE before_value IS DISTINCT FROM after_value;
  IF jsonb_array_length(v_changes)=0 OR NOT EXISTS (SELECT 1 FROM public.promotion_campaign_vendors
    WHERE event_location_id=NEW.id AND status IN ('pending','approved')) THEN RETURN NEW; END IF;
  v_reason:=nullif(btrim(current_setting('mywisata.event_change_reason',true)),'');
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'event_change_reason_required'; END IF;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,note)
    VALUES(auth.uid(),'promotion_campaign_location.arrangements_changed','promotion_campaign_location',NEW.id,
      to_jsonb(OLD),to_jsonb(NEW),v_reason) RETURNING id INTO v_change;
  SELECT jsonb_build_object('eventTitle',c.title,'locationName',NEW.name,'startsOn',NEW.starts_on,
    'endsOn',NEW.ends_on,'changes',v_changes,'reason',v_reason) INTO v_details
    FROM public.promotion_campaigns c WHERE c.id=NEW.campaign_id;
  FOR r IN SELECT id FROM public.promotion_campaign_vendors WHERE event_location_id=NEW.id AND status IN ('pending','approved') LOOP
    PERFORM app_private.queue_event_vendor_change_notice(r.id,v_change,v_details);
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.notify_event_location_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_location_change_notice AFTER UPDATE ON public.promotion_campaign_locations
  FOR EACH ROW EXECUTE FUNCTION app_private.notify_event_location_change();

CREATE OR REPLACE FUNCTION app_private.preview_promotion_campaign_location_change(
  p_campaign_id UUID,p_location_id UUID,p_input JSONB,p_expected_updated_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.promotion_campaign_locations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN
    RAISE EXCEPTION 'promotion_campaign_permission_required'; END IF;
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=p_location_id AND campaign_id=p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_location_not_found'; END IF;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'promotion_campaign_location_cancelled'; END IF;
  IF p_expected_updated_at IS NULL OR l.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'event_change_stale'; END IF;
  RETURN app_private.event_location_change_impact(l.id,p_input->>'address',(p_input->>'lat')::double precision,
    (p_input->>'lng')::double precision,(p_input->>'startsOn')::date,(p_input->>'endsOn')::date,
    (p_input->>'opensAt')::time,(p_input->>'closesAt')::time);
END; $$;

CREATE OR REPLACE FUNCTION public.preview_promotion_campaign_location_change(
  p_campaign_id UUID,p_location_id UUID,p_input JSONB,p_expected_updated_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql SET search_path=public,pg_temp AS $$
  SELECT app_private.preview_promotion_campaign_location_change(p_campaign_id,p_location_id,p_input,p_expected_updated_at);
$$;
REVOKE ALL ON FUNCTION app_private.preview_promotion_campaign_location_change(UUID,UUID,JSONB,TIMESTAMPTZ),
  public.preview_promotion_campaign_location_change(UUID,UUID,JSONB,TIMESTAMPTZ) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.preview_promotion_campaign_location_change(UUID,UUID,JSONB,TIMESTAMPTZ),
  public.preview_promotion_campaign_location_change(UUID,UUID,JSONB,TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.save_promotion_campaign_location_protected(
  p_campaign_id UUID,p_location_id UUID,p_input JSONB,p_expected_updated_at TIMESTAMPTZ,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.promotion_campaign_locations%ROWTYPE; result JSONB; v_changed BOOLEAN; v_notify BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN
    RAISE EXCEPTION 'promotion_campaign_permission_required'; END IF;
  PERFORM app_private.lock_event_campaign(p_campaign_id);
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=p_location_id AND campaign_id=p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_location_not_found'; END IF;
  IF l.status<>'active' THEN RAISE EXCEPTION 'promotion_campaign_location_cancelled'; END IF;
  IF p_expected_updated_at IS NULL OR l.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'event_change_stale'; END IF;
  PERFORM set_config('mywisata.event_change_reason',coalesce(btrim(p_reason),''),true);
  result:=public.save_promotion_campaign_location(p_campaign_id,p_location_id,p_input->>'name',p_input->>'address',
    (p_input->>'lat')::double precision,(p_input->>'lng')::double precision,(p_input->>'startsOn')::date,
    (p_input->>'endsOn')::date,(p_input->>'opensAt')::time,(p_input->>'closesAt')::time);
  v_changed:=(l.name,l.address,l.lat,l.lng,l.starts_on,l.ends_on,l.opens_at,l.closes_at) IS DISTINCT FROM
    (result->>'name',result->>'address',(result->>'lat')::double precision,(result->>'lng')::double precision,
      (result->>'starts_on')::date,(result->>'ends_on')::date,(result->>'opens_at')::time,(result->>'closes_at')::time);
  v_notify:=v_changed AND EXISTS(SELECT 1 FROM public.promotion_campaign_vendors WHERE event_location_id=l.id AND status IN ('pending','approved'));
  PERFORM set_config('mywisata.event_change_reason','',true);
  RETURN result||jsonb_build_object('notificationQueued',v_notify);
END; $$;
CREATE OR REPLACE FUNCTION public.save_promotion_campaign_location_protected(
  p_campaign_id UUID,p_location_id UUID,p_input JSONB,p_expected_updated_at TIMESTAMPTZ,p_reason TEXT)
RETURNS JSONB LANGUAGE sql SET search_path=public,pg_temp AS $$
  SELECT app_private.save_promotion_campaign_location_protected(p_campaign_id,p_location_id,p_input,p_expected_updated_at,p_reason);
$$;
REVOKE ALL ON FUNCTION app_private.save_promotion_campaign_location_protected(UUID,UUID,JSONB,TIMESTAMPTZ,TEXT),
  public.save_promotion_campaign_location_protected(UUID,UUID,JSONB,TIMESTAMPTZ,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.save_promotion_campaign_location_protected(UUID,UUID,JSONB,TIMESTAMPTZ,TEXT),
  public.save_promotion_campaign_location_protected(UUID,UUID,JSONB,TIMESTAMPTZ,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.change_campaign_vendor_stall(
  p_registration_id UUID,p_expected_updated_at TIMESTAMPTZ,p_stall_number TEXT,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.promotion_campaign_vendors%ROWTYPE; l public.promotion_campaign_locations%ROWTYPE;
  c public.promotion_campaigns%ROWTYPE; v_change UUID; v_updated TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(),'admin.promotion_campaign.manage') THEN RAISE EXCEPTION 'promotion_campaign_permission_required'; END IF;
  IF p_stall_number IS NULL OR char_length(btrim(p_stall_number)) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'invalid_stall_number'; END IF;
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id=p_registration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM app_private.lock_event_campaign(r.campaign_id);
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=r.event_location_id;
  SELECT * INTO c FROM public.promotion_campaigns WHERE id=r.campaign_id;
  IF l.status<>'active' THEN RAISE EXCEPTION 'promotion_campaign_location_cancelled'; END IF;
  IF (l.ends_on+l.closes_at) AT TIME ZONE 'Asia/Kuala_Lumpur'<=now() THEN RAISE EXCEPTION 'promotion_campaign_location_ended'; END IF;
  IF c.status NOT IN ('approved','paused') OR c.ends_at<=now() THEN RAISE EXCEPTION 'campaign_not_open'; END IF;
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id=p_registration_id FOR UPDATE;
  IF r.status<>'approved' THEN RAISE EXCEPTION 'not_editable'; END IF;
  IF p_expected_updated_at IS NULL OR r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'event_change_stale'; END IF;
  IF r.stall_number=btrim(p_stall_number) THEN
    RETURN jsonb_build_object('stallNumber',r.stall_number,'updatedAt',r.updated_at,'notificationQueued',false);
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'event_change_reason_required'; END IF;
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=r.event_location_id;
  SELECT * INTO c FROM public.promotion_campaigns WHERE id=r.campaign_id;
  UPDATE public.promotion_campaign_vendors SET stall_number=btrim(p_stall_number),updated_at=clock_timestamp()
    WHERE id=r.id RETURNING updated_at INTO v_updated;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,note)
    VALUES(auth.uid(),'promotion_campaign_vendor.stall_changed','promotion_campaign_vendor',r.id,
      jsonb_build_object('stallNumber',r.stall_number),jsonb_build_object('stallNumber',btrim(p_stall_number)),btrim(p_reason)) RETURNING id INTO v_change;
  PERFORM app_private.queue_event_vendor_change_notice(r.id,v_change,jsonb_build_object('eventTitle',c.title,
    'locationName',l.name,'startsOn',l.starts_on,'endsOn',l.ends_on,'reason',btrim(p_reason),
    'changes',jsonb_build_array(jsonb_build_object('field','stallNumber','before',r.stall_number,'after',btrim(p_stall_number)))));
  RETURN jsonb_build_object('stallNumber',btrim(p_stall_number),'updatedAt',v_updated,'notificationQueued',true);
END; $$;
CREATE OR REPLACE FUNCTION public.change_campaign_vendor_stall(
  p_registration_id UUID,p_expected_updated_at TIMESTAMPTZ,p_stall_number TEXT,p_reason TEXT)
RETURNS JSONB LANGUAGE sql SET search_path=public,pg_temp AS $$
  SELECT app_private.change_campaign_vendor_stall(p_registration_id,p_expected_updated_at,p_stall_number,p_reason);
$$;
REVOKE ALL ON FUNCTION app_private.change_campaign_vendor_stall(UUID,TIMESTAMPTZ,TEXT,TEXT),
  public.change_campaign_vendor_stall(UUID,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.change_campaign_vendor_stall(UUID,TIMESTAMPTZ,TEXT,TEXT),
  public.change_campaign_vendor_stall(UUID,TIMESTAMPTZ,TEXT,TEXT) TO authenticated;
NOTIFY pgrst,'reload schema';
