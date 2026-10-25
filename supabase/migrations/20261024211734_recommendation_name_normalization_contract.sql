-- Restore a legacy dependency in the canonical forward chain. Do not rewrite
-- existing rows or their review versions just to repair this schema contract.
ALTER TABLE public.vendor_recommendations ADD COLUMN IF NOT EXISTS vendor_name_normalized text;
CREATE OR REPLACE FUNCTION public.normalize_vendor_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT lower(regexp_replace(btrim(translate(normalize(p_name,NFKC),U&'\200B\200C\200D\FEFF\00AD\2060','')),'\s+',' ','g'));
$$;
REVOKE ALL ON FUNCTION public.normalize_vendor_name(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.normalize_vendor_name(text) TO authenticated,service_role;
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('app_private.resubmit_recommendation(uuid,timestamptz,jsonb,uuid[],uuid[])'::regprocedure) INTO definition;
  IF position('vendor_name_normalized=lower(btrim(p_data->>''vendorName''))' IN definition)=0 THEN RAISE EXCEPTION 'resubmission_normalization_source_changed'; END IF;
  definition:=replace(definition,'AND vendor_name_normalized=lower(btrim(p_data->>''vendorName''))','AND public.normalize_vendor_name(vendor_name)=public.normalize_vendor_name(p_data->>''vendorName'')');
  definition:=replace(definition,'vendor_name_normalized=lower(btrim(p_data->>''vendorName''))','vendor_name_normalized=public.normalize_vendor_name(p_data->>''vendorName'')');
  EXECUTE definition;
END;
$migration$;
NOTIFY pgrst,'reload schema';
