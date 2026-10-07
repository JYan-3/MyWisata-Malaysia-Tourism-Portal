-- Guests are separate private subjects, never Auth users.
CREATE TABLE public.guest_checkout_subjects (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token_hash TEXT NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ
);
CREATE TABLE public.guest_rate_limits (
 key_hash TEXT PRIMARY KEY, window_started_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL
);
ALTER TABLE public.guest_checkout_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_checkout_subjects, public.guest_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.guest_checkout_subjects, public.guest_rate_limits TO service_role;
CREATE FUNCTION public.reserve_guest_rate_limit(p_key_hash TEXT,p_limit INTEGER,p_window_seconds INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count INTEGER;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 1000 OR p_window_seconds NOT BETWEEN 1 AND 86400 OR p_key_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 INSERT INTO public.guest_rate_limits AS r VALUES(p_key_hash,clock_timestamp(),1)
 ON CONFLICT(key_hash) DO UPDATE SET
 attempts=CASE WHEN r.window_started_at < clock_timestamp()-make_interval(secs=>p_window_seconds) THEN 1 ELSE r.attempts+1 END,
 window_started_at=CASE WHEN r.window_started_at < clock_timestamp()-make_interval(secs=>p_window_seconds) THEN clock_timestamp() ELSE r.window_started_at END
 RETURNING attempts INTO v_count;
 RETURN v_count<=p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.reserve_guest_rate_limit(TEXT,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_guest_rate_limit(TEXT,INTEGER,INTEGER) TO service_role;
DO $$
DECLARE v_table TEXT; v_owner TEXT;
BEGIN
 FOR v_table,v_owner IN SELECT * FROM (VALUES ('carts','user_id'),('orders','user_id'),('checkout_sessions','user_id'),('bookings','customer_id'),('ticket_passes','customer_id'),('digital_entitlements','user_id')) AS t(a,b) LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN guest_subject_id UUID REFERENCES public.guest_checkout_subjects(id), ALTER COLUMN %I DROP NOT NULL, ADD CONSTRAINT %I CHECK(num_nonnulls(%I,guest_subject_id)=1)',v_table,v_owner,v_table||'_owner_xor',v_owner);
 END LOOP;
END; $$;
-- NULLs remain distinct; full unique supports PostgREST ON CONFLICT inference.
ALTER TABLE public.carts ADD CONSTRAINT carts_guest_subject_unique UNIQUE(guest_subject_id);
CREATE UNIQUE INDEX checkout_guest_idempotency ON public.checkout_sessions(guest_subject_id,idempotency_key) WHERE guest_subject_id IS NOT NULL;
ALTER TABLE public.orders ADD COLUMN contact_email TEXT, ADD COLUMN contact_name TEXT, ADD COLUMN contact_phone TEXT;
UPDATE public.orders o SET contact_email=u.email,contact_name=u.full_name,contact_phone=u.phone FROM public.users u WHERE u.id=o.user_id;

CREATE OR REPLACE FUNCTION public.enforce_phone_verified_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.guest_subject_id IS NOT NULL THEN
  IF coalesce(auth.role(),'')<>'service_role' OR NEW.user_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guest_checkout_subjects WHERE id=NEW.guest_subject_id AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'checkout_not_owned'; END IF;
  IF NEW.contact_email IS NULL OR NEW.contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN RAISE EXCEPTION 'contact_email_required'; END IF;
 ELSE
  IF coalesce(auth.role(),'')<>'service_role' AND (auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'checkout_not_owned'; END IF;
  IF NOT public.customer_is_active_email_verified(NEW.user_id) THEN RAISE EXCEPTION 'email_verification_required'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.enforce_phone_verified_booking()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.guest_subject_id IS NOT NULL THEN
  IF coalesce(auth.role(),'')<>'service_role' OR NEW.customer_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guest_checkout_subjects WHERE id=NEW.guest_subject_id AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'booking_not_owned'; END IF;
 ELSE
  IF coalesce(auth.role(),'')<>'service_role' AND (auth.uid() IS NULL OR NEW.customer_id IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'booking_not_owned'; END IF;
  IF NOT public.customer_is_active_email_verified(NEW.customer_id) THEN RAISE EXCEPTION 'email_verification_required'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE oi.id=NEW.order_item_id AND o.user_id IS NOT DISTINCT FROM NEW.customer_id AND o.guest_subject_id IS NOT DISTINCT FROM NEW.guest_subject_id) THEN RAISE EXCEPTION 'booking_not_owned'; END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION public.enforce_commerce_parent_owner() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_user UUID;v_guest UUID; v_child_user UUID;
BEGIN
 IF TG_TABLE_NAME='checkout_sessions' THEN
  SELECT user_id,guest_subject_id INTO v_user,v_guest FROM public.orders WHERE id=NEW.order_id;
  v_child_user:=NEW.user_id;
  IF NOT EXISTS(SELECT 1 FROM public.carts WHERE id=NEW.cart_id AND user_id IS NOT DISTINCT FROM v_user AND guest_subject_id IS NOT DISTINCT FROM v_guest) THEN RAISE EXCEPTION 'cart_not_owned'; END IF;
 ELSIF TG_TABLE_NAME='ticket_passes' THEN
  SELECT customer_id,guest_subject_id INTO v_user,v_guest FROM public.bookings WHERE id=NEW.booking_id AND order_item_id=NEW.order_item_id;
  v_child_user:=NEW.customer_id;
 ELSE
  SELECT o.user_id,o.guest_subject_id INTO v_user,v_guest FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE oi.id=NEW.order_item_id;
  v_child_user:=NEW.user_id;
 END IF;
 IF num_nonnulls(v_user,v_guest)<>1 OR v_user IS DISTINCT FROM v_child_user OR v_guest IS DISTINCT FROM NEW.guest_subject_id THEN RAISE EXCEPTION 'commerce_parent_not_owned'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER checkout_parent_owner BEFORE INSERT OR UPDATE OF user_id,guest_subject_id,order_id,cart_id ON public.checkout_sessions FOR EACH ROW EXECUTE FUNCTION public.enforce_commerce_parent_owner();
CREATE TRIGGER ticket_parent_owner BEFORE INSERT OR UPDATE OF customer_id,guest_subject_id,booking_id,order_item_id ON public.ticket_passes FOR EACH ROW EXECUTE FUNCTION public.enforce_commerce_parent_owner();
CREATE TRIGGER digital_parent_owner BEFORE INSERT OR UPDATE OF user_id,guest_subject_id,order_item_id ON public.digital_entitlements FOR EACH ROW EXECUTE FUNCTION public.enforce_commerce_parent_owner();
REVOKE ALL ON FUNCTION public.enforce_commerce_parent_owner() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
