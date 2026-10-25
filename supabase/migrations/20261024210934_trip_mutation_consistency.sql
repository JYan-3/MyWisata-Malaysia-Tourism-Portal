-- All customer writes lock the parent before touching stops. No snapshot upsert.
CREATE FUNCTION app_private.assert_trip_schedule(p_trip_id text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE t public.trips%ROWTYPE;
BEGIN
  SELECT * INTO STRICT t FROM public.trips WHERE id=p_trip_id;
  IF EXISTS(SELECT 1 FROM public.trip_items WHERE trip_id=p_trip_id AND
    ((scheduled_date IS NOT NULL AND (t.start_date IS NULL OR t.end_date IS NULL OR scheduled_date<t.start_date OR scheduled_date>t.end_date))
    OR (scheduled_time IS NOT NULL AND scheduled_date IS NULL)
    OR (is_day_origin AND (source<>'location' OR experience_id IS NOT NULL OR scheduled_date IS NULL OR scheduled_time IS NOT NULL))))
  THEN RAISE EXCEPTION 'trip_schedule_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM (SELECT is_day_origin,scheduled_date,
    row_number() OVER(PARTITION BY scheduled_date ORDER BY sequence,id) n FROM public.trip_items WHERE trip_id=p_trip_id) x WHERE is_day_origin AND n<>1)
    OR EXISTS(SELECT 1 FROM public.trip_items WHERE trip_id=p_trip_id AND is_day_origin GROUP BY scheduled_date HAVING count(*)>1)
  THEN RAISE EXCEPTION 'trip_daily_origin_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM (SELECT scheduled_time,
    lag(floor(extract(epoch FROM scheduled_time)/60)) OVER(PARTITION BY scheduled_date ORDER BY sequence,id) previous
    FROM public.trip_items WHERE trip_id=p_trip_id AND scheduled_time IS NOT NULL) x
    WHERE floor(extract(epoch FROM scheduled_time)/60)<=previous)
  THEN RAISE EXCEPTION 'trip_non_chronological'; END IF;
END; $$;
REVOKE ALL ON FUNCTION app_private.assert_trip_schedule(text) FROM PUBLIC,anon,authenticated,service_role;

-- Match the existing operating-hours helper, including previous-day overnight periods.
CREATE FUNCTION app_private.trip_hours_available(p_hours jsonb,p_date date,p_time time) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH days AS (
    SELECT offset_day,p_hours->(ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM p_date+offset_day)::int+1] AS day_hours
    FROM generate_series(-1,1) offset_day
  ), periods AS (
    SELECT offset_day,period FROM days CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN (day_hours->>'closed')::boolean THEN '[]'::jsonb
        WHEN (day_hours->>'allDay')::boolean THEN '[{"open":"00:00","close":"24:00"}]'::jsonb
        WHEN jsonb_typeof(day_hours->'periods')='array' AND jsonb_array_length(day_hours->'periods')>0 THEN day_hours->'periods'
        ELSE jsonb_build_array(day_hours) END) period
  ), ranges AS (
    SELECT offset_day,split_part(period->>'open',':',1)::int*60+split_part(period->>'open',':',2)::int a,
      split_part(period->>'close',':',1)::int*60+split_part(period->>'close',':',2)::int b
    FROM periods WHERE period->>'open' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$' AND period->>'close' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
  ) SELECT EXISTS(SELECT 1 FROM ranges WHERE extract(epoch FROM p_time)/60>=offset_day*1440+a
    AND extract(epoch FROM p_time)/60<offset_day*1440+b+CASE WHEN b<=a THEN 1440 ELSE 0 END);
$$;
REVOKE ALL ON FUNCTION app_private.trip_hours_available(jsonb,date,time) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.mutate_customer_trip(p_trip_id text,p_expected_version timestamptz,p_operation text,p_input jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.trips%ROWTYPE; i public.trip_items%ROWTYPE; product public.products%ROWTYPE; outlet public.outlets%ROWTYPE;
  item_id text; ids text[]; version timestamptz; value jsonb; position integer; n integer; category_slug text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_operation='create' THEN
    IF char_length(btrim(coalesce(p_input->>'name',''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'trip_invalid'; END IF;
    INSERT INTO public.trips(id,user_id,name,start_date,end_date) VALUES(gen_random_uuid()::text,auth.uid(),btrim(p_input->>'name'),nullif(p_input->>'start_date','')::date,nullif(p_input->>'end_date','')::date) RETURNING * INTO t;
    IF (t.start_date IS NULL)<>(t.end_date IS NULL) OR t.start_date>t.end_date THEN RAISE EXCEPTION 'trip_dates_invalid'; END IF;
    RETURN jsonb_build_object('value',to_jsonb(t)-'legacy_id','version',t.updated_at);
  END IF;
  SELECT * INTO t FROM public.trips WHERE id=p_trip_id AND user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF p_expected_version IS NULL OR t.updated_at IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'trip_changed'; END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'trip_invalid'; END IF;
  item_id := p_input->>'item_id';
  IF p_operation IN ('schedule','location','remove','replace') THEN
    SELECT * INTO i FROM public.trip_items WHERE id=item_id AND trip_id=t.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'trip_item_not_found'; END IF;
  END IF;
  IF p_operation='delete' THEN
    DELETE FROM public.trips WHERE id=t.id;
    RETURN jsonb_build_object('value',null,'version',t.updated_at);
  ELSIF p_operation='clear' THEN
    DELETE FROM public.trip_items WHERE trip_id=t.id;
  ELSIF p_operation='remove' THEN
    DELETE FROM public.trip_items WHERE id=i.id AND trip_id=t.id;
  ELSIF p_operation='reorder' THEN
    IF jsonb_typeof(p_input->'ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'trip_order_invalid'; END IF;
    SELECT array_agg(v) INTO ids FROM jsonb_array_elements_text(p_input->'ids') v;
    ids := coalesce(ids,'{}');
    SELECT count(*) INTO n FROM public.trip_items WHERE trip_id=t.id;
    IF cardinality(ids)<>n OR (SELECT count(DISTINCT v) FROM unnest(ids) v)<>n OR
      EXISTS(SELECT 1 FROM unnest(ids) v WHERE NOT EXISTS(SELECT 1 FROM public.trip_items WHERE trip_id=t.id AND id=v))
    THEN RAISE EXCEPTION 'trip_order_invalid'; END IF;
    UPDATE public.trip_items s SET sequence=chosen.ordinality-1 FROM unnest(ids) WITH ORDINALITY chosen(id,ordinality) WHERE s.id=chosen.id AND s.trip_id=t.id;
  ELSIF p_operation='schedule' THEN
    UPDATE public.trip_items SET scheduled_date=nullif(p_input->>'scheduled_date','')::date,scheduled_time=nullif(p_input->>'scheduled_time','')::time WHERE id=i.id AND trip_id=t.id RETURNING * INTO i;
  ELSIF p_operation='location' THEN
    IF i.source<>'location' THEN RAISE EXCEPTION 'trip_item_not_found'; END IF;
    UPDATE public.trip_items SET label=btrim(p_input->>'label'),lat=(p_input->>'lat')::double precision,lng=(p_input->>'lng')::double precision WHERE id=i.id AND trip_id=t.id RETURNING * INTO i;
  ELSIF p_operation='add' THEN
    IF (SELECT count(*) FROM public.trip_items WHERE trip_id=t.id)>=1000 THEN RAISE EXCEPTION 'trip_item_limit'; END IF;
    i.id:=gen_random_uuid()::text; i.trip_id:=t.id; i.source:=p_input->>'source'; i.kind:=p_input->>'kind';
    i.experience_id:=nullif(p_input->>'experience_id','')::uuid; i.outlet_id:=nullif(p_input->>'outlet_id','')::uuid;
    i.scheduled_date:=nullif(p_input->>'scheduled_date','')::date; i.scheduled_time:=nullif(p_input->>'scheduled_time','')::time;
    i.is_day_origin:=coalesce((p_input->>'is_day_origin')::boolean,false);
    i.lat:=(p_input->>'lat')::double precision; i.lng:=(p_input->>'lng')::double precision;
    i.label:=btrim(p_input->>'label'); i.sublabel:=p_input->>'sublabel'; i.created_at:=now();
    IF i.source='location' THEN i.experience_id:=null; i.outlet_id:=null; END IF;
    SELECT coalesce(max(sequence)+1,0) INTO i.sequence FROM public.trip_items WHERE trip_id=t.id;
    IF i.is_day_origin THEN
      SELECT min(sequence) INTO position FROM public.trip_items WHERE trip_id=t.id AND scheduled_date=i.scheduled_date;
      IF position IS NOT NULL THEN
        UPDATE public.trip_items SET sequence=sequence+1 WHERE trip_id=t.id AND sequence>=position;
        i.sequence:=position;
      END IF;
    END IF;
  ELSIF p_operation='replace' THEN
    IF i.source<>'vendor' THEN RAISE EXCEPTION 'trip_item_not_found'; END IF;
    i.experience_id:=(p_input->>'experience_id')::uuid; i.outlet_id:=nullif(p_input->>'outlet_id','')::uuid;
  ELSE RAISE EXCEPTION 'trip_operation_invalid'; END IF;

  -- Resolve listing ownership and current visibility inside this transaction.
  IF p_operation IN ('add','replace') AND i.source='vendor' THEN
    SELECT p.* INTO product FROM public.products p JOIN public.vendors v ON v.id=p.vendor_id
      WHERE p.id=i.experience_id AND p.status='active' AND p.review_status='approved' AND v.status='approved' FOR SHARE OF p,v;
    IF NOT FOUND THEN RAISE EXCEPTION 'trip_activity_unavailable'; END IF;
    i.outlet_id:=coalesce(i.outlet_id,product.outlet_id);
    SELECT o.* INTO outlet FROM public.outlets o WHERE o.id=i.outlet_id AND o.vendor_id=product.vendor_id AND o.status='active' AND o.review_status='approved'
      AND (o.id=product.outlet_id OR EXISTS(SELECT 1 FROM public.outlet_offers f WHERE f.product_id=product.id AND f.outlet_id=o.id AND f.status='active')) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'trip_outlet_unavailable'; END IF;
    i.label:=product.name; i.sublabel:=outlet.city; i.lat:=outlet.lat; i.lng:=outlet.lng;
    SELECT slug INTO category_slug FROM public.categories WHERE id=product.category_id;
    IF i.scheduled_date IS NOT NULL AND category_slug='accommodation' AND i.scheduled_time IS NOT NULL THEN RAISE EXCEPTION 'trip_schedule_invalid'; END IF;
    IF p_operation='replace' AND i.scheduled_date IS NOT NULL AND NOT product.requires_booking AND category_slug IS DISTINCT FROM 'accommodation' THEN
      IF i.scheduled_time IS NOT NULL THEN
        IF NOT app_private.trip_hours_available(outlet.operating_hours,i.scheduled_date,i.scheduled_time) THEN RAISE EXCEPTION 'trip_schedule_unavailable'; END IF;
      ELSIF NOT EXISTS(SELECT 1 FROM generate_series(0,47) n WHERE app_private.trip_hours_available(outlet.operating_hours,i.scheduled_date,('00:00'::time+n*interval '30 minutes')::time)) THEN RAISE EXCEPTION 'trip_schedule_unavailable'; END IF;
    END IF;
    IF i.scheduled_date IS NOT NULL AND product.requires_booking AND category_slug IS DISTINCT FROM 'accommodation' THEN
      PERFORM 1 FROM public.booking_slots b WHERE b.product_id=product.id AND b.outlet_id=outlet.id AND b.status='available' AND b.booked<b.capacity
        AND b.starts_at>now() AND (b.starts_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date=i.scheduled_date
        AND (i.scheduled_time IS NULL OR to_char(b.starts_at AT TIME ZONE 'Asia/Kuala_Lumpur','HH24:MI')=to_char(i.scheduled_time,'HH24:MI')) FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'trip_schedule_unavailable'; END IF;
    END IF;
  END IF;
  IF p_operation='add' THEN
    IF i.source NOT IN ('vendor','location') OR i.source IS NULL OR (i.kind IS NOT NULL AND i.kind NOT IN ('custom','gps')) THEN RAISE EXCEPTION 'trip_invalid'; END IF;
    INSERT INTO public.trip_items(id,trip_id,experience_id,outlet_id,sequence,scheduled_date,scheduled_time,source,kind,lat,lng,label,sublabel,is_day_origin,created_at)
      VALUES(i.id,i.trip_id,i.experience_id,i.outlet_id,i.sequence,i.scheduled_date,i.scheduled_time,i.source,i.kind,i.lat,i.lng,i.label,i.sublabel,i.is_day_origin,i.created_at);
  ELSIF p_operation='replace' THEN
    UPDATE public.trip_items SET experience_id=i.experience_id,outlet_id=i.outlet_id,label=i.label,sublabel=i.sublabel,lat=i.lat,lng=i.lng WHERE id=i.id AND trip_id=t.id;
  END IF;
  IF p_operation IN ('add','replace','location') AND (i.label IS NULL OR char_length(i.label) NOT BETWEEN 1 AND 200 OR i.lat IS NULL OR i.lat NOT BETWEEN -90 AND 90 OR i.lng IS NULL OR i.lng NOT BETWEEN -180 AND 180 OR char_length(coalesce(i.sublabel,''))>300) THEN RAISE EXCEPTION 'trip_invalid'; END IF;
  PERFORM app_private.assert_trip_schedule(t.id);
  UPDATE public.trips SET updated_at=greatest(clock_timestamp(),t.updated_at+interval '1 microsecond') WHERE id=t.id RETURNING updated_at INTO version;
  IF p_operation='reorder' THEN SELECT coalesce(jsonb_agg(to_jsonb(s)-'legacy_id' ORDER BY sequence,id),'[]') INTO value FROM public.trip_items s WHERE trip_id=t.id;
  ELSIF p_operation IN ('add','schedule','location','replace') THEN SELECT to_jsonb(s)-'legacy_id' INTO value FROM public.trip_items s WHERE id=i.id AND trip_id=t.id;
  END IF;
  RETURN jsonb_build_object('value',value,'version',version);
END; $$;
REVOKE ALL ON FUNCTION app_private.mutate_customer_trip(text,timestamptz,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.mutate_customer_trip(text,timestamptz,text,jsonb) TO authenticated;
CREATE FUNCTION public.mutate_customer_trip(p_trip_id text,p_expected_version timestamptz,p_operation text,p_input jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.mutate_customer_trip($1,$2,$3,$4); $$;
REVOKE ALL ON FUNCTION public.mutate_customer_trip(text,timestamptz,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.mutate_customer_trip(text,timestamptz,text,jsonb) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.trips,public.trip_items FROM anon,authenticated;
NOTIFY pgrst,'reload schema';
