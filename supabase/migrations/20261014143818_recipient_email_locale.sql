-- Recipient-owned presentation data only. Money, stock, authorization and delivery leases are unchanged.
CREATE FUNCTION app_private.normalize_email_locale(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT CASE WHEN value IN ('en','zh-CN','ms') THEN value ELSE 'en' END $$;

-- First signup already has Auth metadata when its existing profile trigger runs.
CREATE FUNCTION app_private.initialize_profile_email_locale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.preferred_locale IS NULL THEN
  SELECT app_private.normalize_email_locale(a.raw_user_meta_data->>'preferred_locale') INTO NEW.preferred_locale
  FROM auth.users a WHERE a.id=NEW.id;
  NEW.preferred_locale:=coalesce(NEW.preferred_locale,'en');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER initialize_profile_email_locale BEFORE INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION app_private.initialize_profile_email_locale();

-- Atomic projection: a locale save cannot succeed while Auth mail keeps an old language.
-- Copy exactly one presentation key; never replace unrelated metadata or app_metadata.
CREATE FUNCTION app_private.project_auth_email_locale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE auth.users SET raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)
  || jsonb_build_object('preferred_locale',app_private.normalize_email_locale(NEW.preferred_locale))
 WHERE id=NEW.id AND raw_user_meta_data->>'preferred_locale'
  IS DISTINCT FROM app_private.normalize_email_locale(NEW.preferred_locale);
 RETURN NEW;
END $$;
CREATE TRIGGER project_auth_email_locale AFTER INSERT OR UPDATE OF preferred_locale ON public.users
FOR EACH ROW EXECUTE FUNCTION app_private.project_auth_email_locale();
UPDATE auth.users a SET raw_user_meta_data=coalesce(a.raw_user_meta_data,'{}'::jsonb)
 || jsonb_build_object('preferred_locale',app_private.normalize_email_locale(u.preferred_locale))
FROM public.users u WHERE u.id=a.id AND a.raw_user_meta_data->>'preferred_locale'
 IS DISTINCT FROM app_private.normalize_email_locale(u.preferred_locale);

-- Match Auth verification's auth.users -> public.users lock order.
-- The caller can change only their own presentation preference.
CREATE FUNCTION public.set_my_preferred_locale(p_locale text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE caller uuid:=auth.uid();
BEGIN
 IF caller IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
 IF p_locale IS NULL OR p_locale NOT IN ('en','zh-CN','ms') THEN RAISE EXCEPTION 'unsupported_locale' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM auth.users WHERE id=caller FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_unavailable' USING ERRCODE='P0002'; END IF;
 UPDATE public.users SET preferred_locale=p_locale WHERE id=caller;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_unavailable' USING ERRCODE='P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_my_preferred_locale(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_my_preferred_locale(text) TO authenticated;

ALTER TABLE public.orders ADD COLUMN contact_locale text NOT NULL DEFAULT 'en'
 CHECK(contact_locale IN ('en','zh-CN','ms'));
CREATE FUNCTION app_private.snapshot_order_email_locale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.guest_subject_id IS NOT NULL THEN
  NEW.contact_locale:=app_private.normalize_email_locale(current_setting('mywisata.guest_email_locale',true));
 ELSE
  SELECT app_private.normalize_email_locale(u.preferred_locale) INTO NEW.contact_locale FROM public.users u WHERE u.id=NEW.user_id;
  NEW.contact_locale:=coalesce(NEW.contact_locale,'en');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER snapshot_order_email_locale BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION app_private.snapshot_order_email_locale();

-- Set transaction-local presentation context in the existing service-only wrappers.
-- The transaction cores retain every existing subject, price, stock and idempotency guard.
DO $$ DECLARE r record; source text; found_count integer:=0; BEGIN
 FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('guest_prepare_checkout','guest_prepare_event_checkout') LOOP
  source:=pg_get_functiondef(r.oid);
  IF position('BEGIN RETURN ' IN source)=0 OR position('p_contact' IN source)=0 THEN RAISE EXCEPTION 'guest_locale_wrapper_preflight_required'; END IF;
  source:=replace(source,'BEGIN RETURN ', 'BEGIN PERFORM pg_catalog.set_config(''mywisata.guest_email_locale'',coalesce(p_contact->>''locale'',''en''),true); RETURN ');
  EXECUTE source; found_count:=found_count+1;
 END LOOP;
 IF found_count<>2 THEN RAISE EXCEPTION 'guest_locale_wrapper_count_invalid'; END IF;
END $$;

CREATE FUNCTION app_private.snapshot_recipient_email_locale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chosen text; matched boolean:=false; phase text; message text; details text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.status='sent' OR coalesce(to_jsonb(OLD)->>'delivery_state','')='unknown'
   OR coalesce(to_jsonb(NEW)->>'delivery_state','')='unknown' THEN RETURN NEW; END IF;
  IF OLD.payload->>'locale' IN ('en','zh-CN','ms') THEN
   NEW.payload:=coalesce(NEW.payload,'{}'::jsonb)||jsonb_build_object('locale',OLD.payload->>'locale');
   RETURN NEW;
  END IF;
 END IF;
 NEW.payload:=coalesce(NEW.payload,'{}'::jsonb);
 IF NEW.user_id IS NOT NULL THEN
  SELECT u.preferred_locale INTO chosen FROM public.users u WHERE u.id=NEW.user_id
   AND lower(btrim(u.email))=lower(btrim(NEW.to_email));
  -- An account mail's caller-supplied locale must not override the recipient.
  chosen:=app_private.normalize_email_locale(chosen);
 ELSE
  IF coalesce(NEW.payload->>'reference','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
   SELECT o.contact_locale INTO chosen FROM public.orders o WHERE o.id=(NEW.payload->>'reference')::uuid
    AND o.user_id IS NULL AND o.guest_subject_id IS NOT NULL
    AND lower(btrim(o.contact_email))=lower(btrim(NEW.to_email));
   matched:=FOUND;
  END IF;
  IF NOT matched THEN
   SELECT CASE WHEN count(*)=1 THEN max(u.preferred_locale) ELSE NULL END INTO chosen
   FROM public.users u WHERE lower(btrim(u.email))=lower(btrim(NEW.to_email));
   -- A valid saved preference wins over a provided language for known recipients.
   IF chosen IS NULL THEN chosen:=NEW.payload->>'locale'; END IF;
  END IF;
 END IF;
 NEW.payload:=NEW.payload||jsonb_build_object('locale',app_private.normalize_email_locale(chosen));
 IF NEW.event_key LIKE 'vendor_exception:%' THEN
  phase:=split_part(NEW.event_key,':',3);
  message:=CASE phase
   WHEN 'payment_blocked' THEN 'Payment was received but this reservation cannot be fulfilled. Do not prepare or hand over goods. Admin is reviewing the payment.'
   WHEN 'pickup_review' THEN 'The pickup date has passed and collection is unconfirmed. Please verify whether your items were handed over and contact Admin with the actual outcome.'
   WHEN 'refund_pending' THEN 'A refund is under review or awaiting the payment provider. It has not been confirmed complete. Contact Admin before further fulfilment.'
   WHEN 'refund_attention' THEN 'A refund needs Admin attention. Completion has not been confirmed. Contact Admin before further fulfilment.'
   WHEN 'refunded' THEN 'The order refund has been confirmed complete. Review your order and settlement records.'
   WHEN 'collected' THEN 'Collection has been verified and the pickup exception is closed.'
   WHEN 'no_show' THEN 'Admin has verified non-collection and closed this pickup exception without a refund. This does not mean goods were handed over or funds are immediately available.' END;
  IF message IS NOT NULL AND left(NEW.payload->>'reason',length(message))=message THEN
   details:=btrim(substr(NEW.payload->>'reason',length(message)+1));
   NEW.payload:=NEW.payload||jsonb_build_object('reasonCode',phase,'reasonDetails',details);
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER snapshot_recipient_email_locale BEFORE INSERT OR UPDATE ON public.email_outbox
FOR EACH ROW EXECUTE FUNCTION app_private.snapshot_recipient_email_locale();

REVOKE ALL ON FUNCTION app_private.normalize_email_locale(text),app_private.initialize_profile_email_locale(),
 app_private.project_auth_email_locale(),app_private.snapshot_order_email_locale(),app_private.snapshot_recipient_email_locale()
 FROM PUBLIC,anon,authenticated,service_role;
