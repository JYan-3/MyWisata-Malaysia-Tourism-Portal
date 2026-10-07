CREATE TABLE public.guest_order_access_tokens (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'), expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.guest_order_access_sessions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'), expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.guest_order_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_order_access_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_order_access_tokens,public.guest_order_access_sessions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.guest_order_access_tokens,public.guest_order_access_sessions TO service_role;
CREATE FUNCTION public.exchange_guest_order_access(p_token_hash TEXT,p_session_hash TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_order UUID;
BEGIN
 UPDATE public.guest_order_access_tokens SET consumed_at=now() WHERE token_hash=p_token_hash AND consumed_at IS NULL AND expires_at>now()
 AND EXISTS(SELECT 1 FROM public.orders WHERE id=order_id AND user_id IS NULL AND guest_subject_id IS NOT NULL)
 RETURNING order_id INTO v_order;
 IF v_order IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.guest_order_access_sessions(order_id,token_hash,expires_at) VALUES(v_order,p_session_hash,now()+interval '24 hours');
 RETURN v_order;
END; $$;
REVOKE ALL ON FUNCTION public.exchange_guest_order_access(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_guest_order_access(TEXT,TEXT) TO service_role;
-- Both entry points reuse the installed slot-lock/capacity transaction.
DO $migration$
DECLARE src TEXT;
BEGIN
 SELECT source INTO src FROM app_private.guest_migration_source('public.reschedule_booking(uuid,uuid)');
 IF position('v_booking.user_id <> v_user' IN src)=0 OR position('FOR UPDATE' IN src)=0 THEN RAISE EXCEPTION 'reschedule_source_preflight_required'; END IF;
 src:=replace(src,'v_user UUID := auth.uid();','v_user UUID := p_owner_user;');
 src:=replace(src,'IF v_user IS NULL THEN RAISE EXCEPTION ''auth_required''; END IF;',
 'IF p_owner_guest IS NULL THEN
    IF v_user IS NULL OR v_user IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION ''auth_required''; END IF;
  ELSIF coalesce(auth.role(),'''')<>''service_role'' THEN RAISE EXCEPTION ''auth_required''; END IF;');
 src:=replace(src,'oi.quantity, o.user_id','oi.quantity, o.user_id, o.guest_subject_id AS order_guest_subject_id');
 src:=replace(src,'v_booking.user_id <> v_user','v_booking.user_id IS DISTINCT FROM p_owner_user OR v_booking.order_guest_subject_id IS DISTINCT FROM p_owner_guest');
 EXECUTE format('CREATE FUNCTION public.reschedule_booking_core(p_booking_id UUID,p_new_slot_id UUID,p_owner_user UUID,p_owner_guest UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS %L',src);
END; $migration$;
REVOKE ALL ON FUNCTION public.reschedule_booking_core(UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE target_schema text; BEGIN
 SELECT owner_schema INTO target_schema FROM app_private.guest_migration_source('public.reschedule_booking(uuid,uuid)');
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.reschedule_booking(p_booking_id UUID,p_new_slot_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS %L',
   target_schema,'BEGIN RETURN public.reschedule_booking_core(p_booking_id,p_new_slot_id,auth.uid(),NULL); END;');
END; $$;
CREATE FUNCTION public.guest_reschedule_booking(p_booking_id UUID,p_new_slot_id UUID,p_guest_subject_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_guest_subject_id IS NULL OR coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'booking_not_owned'; END IF;
 RETURN public.reschedule_booking_core(p_booking_id,p_new_slot_id,NULL,p_guest_subject_id);
END; $$;
REVOKE ALL ON FUNCTION public.guest_reschedule_booking(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_reschedule_booking(UUID,UUID,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
-- Durable guest confirmation/access mail is inserted in the same transaction as
-- payment. Email failure never rolls back a subsequently committed paid order.
CREATE FUNCTION public.queue_guest_order_access(p_order_id UUID,p_event_key TEXT,p_reason TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_order public.orders%ROWTYPE; v_token TEXT;
BEGIN
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id AND user_id IS NULL AND guest_subject_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.email_outbox WHERE event_key=p_event_key) THEN RETURN; END IF;
 v_token:=rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
 INSERT INTO public.guest_order_access_tokens(order_id,token_hash,expires_at) VALUES(p_order_id,encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '7 days');
 INSERT INTO public.email_outbox(event_key,user_id,to_email,event_type,payload,status,next_attempt_at)
 VALUES(p_event_key,NULL,v_order.contact_email,'checkout_succeeded',jsonb_build_object('recipientName',v_order.contact_name,'amountRm',v_order.total_amount,'reference',v_order.id,'occurredAt',now(),'reason',p_reason,'guestAccessToken',v_token),'pending',now());
END; $$;
REVOKE ALL ON FUNCTION public.queue_guest_order_access(UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_guest_order_access(UUID,TEXT,TEXT) TO service_role;
CREATE FUNCTION public.queue_guest_order_confirmation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.guest_subject_id IS NOT NULL AND NEW.status IN ('paid','completed') AND (TG_OP='INSERT' OR OLD.status NOT IN ('paid','completed')) THEN
  PERFORM public.queue_guest_order_access(NEW.id,'guest-order-confirmation:'||NEW.id,NULL);
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.queue_guest_order_confirmation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guest_order_confirmation AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.queue_guest_order_confirmation();
DO $migration$
DECLARE src TEXT; marker TEXT;
BEGIN
 src:=pg_get_functiondef('public.cancel_event_reservations(uuid,uuid,uuid,text)'::regprocedure);
 marker:='    INSERT INTO public.notifications (user_id, type, title, body, link)';
 IF position(marker IN src)=0 THEN RAISE EXCEPTION 'event_cancel_source_preflight_required'; END IF;
 src:=replace(src,marker,'    IF v_order.user_id IS NOT NULL THEN'||chr(10)||marker);
 src:=replace(src,'''/customer/orders/'' || v_order.id);',
 '''/customer/orders/'' || v_order.id);
    ELSE
      PERFORM public.queue_guest_order_access(v_order.id,''guest-event-cancelled:''||v_order.id,''The organiser cancelled this reservation. Paid reservations follow the existing refund process.'');
    END IF;');
 EXECUTE src;
END; $migration$;
