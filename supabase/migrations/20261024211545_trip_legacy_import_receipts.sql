-- Receipts deliberately survive deletion of the imported trip.
CREATE TABLE app_private.trip_legacy_import_receipts(owner_id uuid NOT NULL,legacy_trip_id text NOT NULL,trip_id text,completed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,legacy_trip_id));
ALTER TABLE app_private.trip_legacy_import_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.trip_legacy_import_receipts FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO app_private.trip_legacy_import_receipts(owner_id,legacy_trip_id,trip_id)
SELECT user_id,legacy_id,id FROM public.trips WHERE legacy_id IS NOT NULL ON CONFLICT DO NOTHING;
CREATE FUNCTION app_private.restore_customer_trip(p_legacy_id text,p_trip jsonb,p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE receipt jsonb; row jsonb; saved_id text; version timestamptz; old_trip text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF char_length(coalesce(p_legacy_id,'')) NOT BETWEEN 1 AND 128 OR p_legacy_id LIKE 'mock-trip-%'
    OR jsonb_typeof(p_trip) IS DISTINCT FROM 'object' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)>1000
  THEN RAISE EXCEPTION 'legacy_trip_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('legacy_trip:'||auth.uid()::text||':'||p_legacy_id,0));
  SELECT trip_id INTO old_trip FROM app_private.trip_legacy_import_receipts WHERE owner_id=auth.uid() AND legacy_trip_id=p_legacy_id;
  IF FOUND THEN RETURN jsonb_build_object('restored',false); END IF;
  receipt:=app_private.mutate_customer_trip('',NULL,'create',p_trip);
  saved_id:=receipt#>>'{value,id}'; version:=(receipt->>'version')::timestamptz;
  UPDATE public.trips SET legacy_id=p_legacy_id WHERE id=saved_id;
  FOR row IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    receipt:=app_private.mutate_customer_trip(saved_id,version,'add',row);
    version:=(receipt->>'version')::timestamptz;
  END LOOP;
  INSERT INTO app_private.trip_legacy_import_receipts(owner_id,legacy_trip_id,trip_id) VALUES(auth.uid(),p_legacy_id,saved_id);
  RETURN jsonb_build_object('restored',true,'id',saved_id);
END; $$;
REVOKE ALL ON FUNCTION app_private.restore_customer_trip(text,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.restore_customer_trip(text,jsonb,jsonb) TO authenticated;
CREATE FUNCTION public.restore_customer_trip(p_legacy_id text,p_trip jsonb,p_items jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.restore_customer_trip($1,$2,$3); $$;
REVOKE ALL ON FUNCTION public.restore_customer_trip(text,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.restore_customer_trip(text,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
