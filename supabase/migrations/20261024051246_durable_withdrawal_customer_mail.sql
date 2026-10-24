-- Persist customer withdrawal mail intents in the same transaction as the
-- withdrawal status. SMTP remains exclusively in the existing outbox worker.
BEGIN;

CREATE FUNCTION app_private.queue_withdrawal_customer_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_name text;
  v_locale text;
  v_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IN ('pending', 'pending_second_approval') THEN
    SELECT nullif(btrim(account.email), ''), account.full_name, account.preferred_locale
      INTO v_email, v_name, v_locale
      FROM public.users AS account
     WHERE account.id = NEW.user_id;
    IF v_email IS NULL THEN RAISE EXCEPTION 'withdrawal_email_recipient_unavailable'; END IF;
    v_payload := jsonb_build_object(
      'locale', coalesce(nullif(v_locale, ''), 'en'),
      'recipientName', v_name,
      'reference', NEW.id::text,
      'amountRm', NEW.amount,
      'occurredAt', now()::text
    );
    INSERT INTO public.email_outbox(event_key, user_id, to_email, event_type, payload, status, next_attempt_at)
    VALUES ('withdrawal_submitted:' || NEW.id::text, NEW.user_id, v_email,
      'withdrawal_submitted', v_payload, 'pending', now())
    ON CONFLICT (event_key) DO NOTHING;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'processing' THEN
    -- New requests use the exact recipient/language snapshot created at
    -- submission. Legacy rows fall back to the current account profile.
    SELECT sent_mail.to_email, sent_mail.payload ->> 'recipientName', sent_mail.payload ->> 'locale'
      INTO v_email, v_name, v_locale
      FROM public.email_outbox AS sent_mail
     WHERE sent_mail.event_key = 'withdrawal_submitted:' || NEW.id::text;
    IF v_email IS NULL THEN
      SELECT nullif(btrim(account.email), ''), account.full_name, account.preferred_locale
        INTO v_email, v_name, v_locale
        FROM public.users AS account
       WHERE account.id = NEW.user_id;
    END IF;
    IF v_email IS NULL THEN RAISE EXCEPTION 'withdrawal_email_recipient_unavailable'; END IF;
    v_payload := jsonb_build_object(
      'locale', coalesce(nullif(v_locale, ''), 'en'),
      'recipientName', v_name,
      'reference', NEW.id::text,
      'amountRm', NEW.amount,
      'occurredAt', now()::text
    );
    INSERT INTO public.email_outbox(event_key, user_id, to_email, event_type, payload, status, next_attempt_at)
    VALUES ('withdrawal_approved:' || NEW.id::text, NEW.user_id, v_email,
      'withdrawal_approved', v_payload, 'pending', now())
    ON CONFLICT (event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.queue_withdrawal_customer_email() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER withdrawal_customer_mail_intent
AFTER INSERT OR UPDATE OF status ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION app_private.queue_withdrawal_customer_email();

NOTIFY pgrst, 'reload schema';
COMMIT;
