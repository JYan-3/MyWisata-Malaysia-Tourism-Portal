ALTER TABLE public.orders
  ADD COLUMN guest_session_revoked_at timestamptz;

ALTER TABLE public.email_outbox
  DROP CONSTRAINT email_outbox_status_check,
  ADD CONSTRAINT email_outbox_status_check
    CHECK (status = ANY (ARRAY['pending','sending','sent','failed','cancelled']::text[]));

CREATE TABLE app_private.guest_contact_corrections (
  request_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  actor_id uuid NOT NULL,
  support_ticket_id uuid NOT NULL REFERENCES public.support_tickets(id),
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('existing_order_access','provider_confirmed_payer')),
  payment_id uuid REFERENCES public.payments(id),
  input_fingerprint text NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  old_email_hash text NOT NULL CHECK (old_email_hash ~ '^[a-f0-9]{64}$'),
  new_email_hash text NOT NULL CHECK (new_email_hash ~ '^[a-f0-9]{64}$'),
  old_email_masked text NOT NULL,
  new_email_masked text NOT NULL,
  event_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE app_private.guest_contact_corrections FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION app_private.assert_guest_contact_correction_authority()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL
    OR NOT coalesce(app_private.staff_authority_assurance(), false)
    OR NOT coalesce(app_private.is_super_admin(v_actor), false) THEN
    RAISE EXCEPTION 'super_admin_required' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.assert_guest_contact_correction_authority() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION app_private.guest_contact_correction_blocker(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.digital_entitlements AS entitlement
      WHERE entitlement.order_id = p_order_id
    ) THEN 'fulfilment_credential_reissue_required'
    WHEN EXISTS (
      SELECT 1
      FROM public.order_items AS item
      LEFT JOIN public.products AS product ON product.id = item.product_id
      WHERE item.order_id = p_order_id
        AND item.fulfil_status <> 'cancelled'
        AND (
          item.food_fulfilment_mode IS NOT NULL
          OR item.event_listing_id IS NOT NULL
          OR item.event_location_id IS NOT NULL
          OR product.product_type = 'digital'
          OR (product.product_type IS NOT NULL AND product.product_type NOT IN ('activity','experience','food','product','service','digital'))
        )
    ) THEN 'fulfilment_credential_reissue_required'
    WHEN EXISTS (
      SELECT 1 FROM public.bookings AS booking
      JOIN public.order_items AS item ON item.id = booking.order_item_id
      WHERE item.order_id = p_order_id
        AND booking.status IN ('confirmed','in_use')
    ) THEN 'fulfilment_credential_reissue_required'
    WHEN EXISTS (
      SELECT 1 FROM public.ticket_passes AS pass
      JOIN public.order_items AS item ON item.id = pass.order_item_id
      WHERE item.order_id = p_order_id
        AND pass.status = 'active'
        AND pass.entries_used < pass.entry_limit
        AND (pass.valid_from IS NULL OR pass.valid_from <= now())
        AND (pass.valid_until IS NULL OR pass.valid_until > now())
    ) THEN 'fulfilment_credential_reissue_required'
    ELSE NULL
  END;
$function$;

REVOKE ALL ON FUNCTION app_private.guest_contact_correction_blocker(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.correct_guest_order_contact(
  p_order_id uuid,
  p_request_id uuid,
  p_expected_contact_email text,
  p_new_email text,
  p_support_ticket_id uuid,
  p_evidence_kind text,
  p_payment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_order public.orders%ROWTYPE;
  v_existing app_private.guest_contact_corrections%ROWTYPE;
  v_mail record;
  v_mail_ids uuid[] := ARRAY[]::uuid[];
  v_mail_count integer := 0;
  v_input_fingerprint text;
  v_event_key text;
  v_blocker text;
  v_token_hash text;
  v_mail_order_id uuid;
  v_mail_count_after integer;
  v_token_count integer;
BEGIN
  v_actor := app_private.assert_guest_contact_correction_authority();

  IF p_order_id IS NULL OR p_request_id IS NULL OR p_support_ticket_id IS NULL
    OR p_evidence_kind IS NULL OR p_evidence_kind NOT IN ('existing_order_access','provider_confirmed_payer')
    OR p_new_email IS NULL OR length(btrim(p_new_email)) > 254
    OR btrim(p_new_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    OR p_expected_contact_email IS NULL
    OR (p_evidence_kind = 'provider_confirmed_payer' AND p_payment_id IS NULL)
    OR (p_evidence_kind = 'existing_order_access' AND p_payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'guest_contact_input_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '5s', true);

  v_input_fingerprint := encode(extensions.digest(convert_to(concat_ws('|',
    p_order_id::text,
    p_expected_contact_email,
    lower(btrim(p_new_email)),
    p_support_ticket_id::text,
    p_evidence_kind,
    coalesce(p_payment_id::text, '')
  ), 'UTF8'), 'sha256'), 'hex');
  v_event_key := 'guest-contact-correction:' || p_order_id::text || ':' || p_request_id::text;

  SELECT * INTO v_order
  FROM public.orders AS orders
  WHERE orders.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'guest_order_unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM app_private.guest_contact_corrections AS correction
  WHERE correction.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.actor_id = v_actor
      AND v_existing.order_id = p_order_id
      AND v_existing.input_fingerprint = v_input_fingerprint THEN
      RETURN jsonb_build_object('orderId', p_order_id, 'orderReference', v_order.display_id, 'delivery', 'queued', 'replayed', true);
    END IF;
    RAISE EXCEPTION 'guest_contact_request_conflict' USING ERRCODE = '23505';
  END IF;

  IF v_order.user_id IS NOT NULL OR v_order.guest_subject_id IS NULL
    OR v_order.status NOT IN ('paid','completed')
    OR v_order.contact_email IS DISTINCT FROM p_expected_contact_email
    OR lower(v_order.contact_email) = lower(btrim(p_new_email)) THEN
    RAISE EXCEPTION 'guest_order_contact_changed' USING ERRCODE = '40001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.support_tickets AS ticket
    WHERE ticket.id = p_support_ticket_id
  ) THEN
    RAISE EXCEPTION 'support_case_unavailable' USING ERRCODE = 'P0002';
  END IF;

  IF p_evidence_kind = 'provider_confirmed_payer' AND NOT EXISTS (
    SELECT 1 FROM public.payments AS payment
    WHERE payment.id = p_payment_id
      AND payment.order_id = p_order_id
      AND payment.status = 'succeeded'
      AND payment.amount > 0
      AND payment.amount <= v_order.total_amount
  ) THEN
    RAISE EXCEPTION 'payment_evidence_unavailable' USING ERRCODE = '22023';
  END IF;

  v_blocker := app_private.guest_contact_correction_blocker(p_order_id);
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'FULFILMENT_CREDENTIAL_REISSUE_REQUIRED' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.email_outbox AS mail WHERE mail.event_key = v_event_key) THEN
    RAISE EXCEPTION 'guest_contact_request_conflict' USING ERRCODE = '23505';
  END IF;

  FOR v_mail IN
    SELECT mail.id, mail.status, mail.delivery_state, mail.delivery_started_at, mail.attempts
    FROM public.email_outbox AS mail
    WHERE mail.user_id IS NULL
      AND mail.payload ? 'guestAccessToken'
      AND coalesce(mail.payload->>'receiptOrderId', mail.payload->>'reference') = p_order_id::text
      AND lower(mail.to_email) = lower(v_order.contact_email)
      AND mail.status IN ('pending','failed','sending')
    ORDER BY mail.id
    LIMIT 101
    FOR UPDATE
  LOOP
    v_mail_count := v_mail_count + 1;
    IF v_mail_count > 100 THEN
      RAISE EXCEPTION 'guest_mail_manual_review_required' USING ERRCODE = '54000';
    END IF;
    IF v_mail.delivery_state = 'unknown' OR (v_mail.status = 'failed' AND v_mail.attempts >= 5) THEN
      RAISE EXCEPTION 'EMAIL_DELIVERY_REVIEW_REQUIRED' USING ERRCODE = '55000';
    END IF;
    IF v_mail.delivery_state = 'in_flight'
      OR v_mail.delivery_state <> 'ready'
      OR v_mail.delivery_started_at IS NOT NULL
      OR (v_mail.status = 'sending' AND v_mail.delivery_started_at IS NOT NULL) THEN
      RAISE EXCEPTION 'EMAIL_DELIVERY_BUSY' USING ERRCODE = '55000';
    END IF;
    v_mail_ids := array_append(v_mail_ids, v_mail.id);
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.email_outbox AS mail WHERE mail.event_key = v_event_key) THEN
    RAISE EXCEPTION 'guest_contact_request_conflict' USING ERRCODE = '23505';
  END IF;

  UPDATE public.email_outbox AS mail
  SET status = 'cancelled',
      lease_token = gen_random_uuid(),
      lease_expires_at = NULL,
      delivery_started_at = NULL,
      payload = mail.payload - 'guestAccessToken',
      last_error = 'superseded_guest_contact_correction',
      updated_at = now()
  WHERE mail.id = ANY(v_mail_ids);

  UPDATE public.orders AS orders
  SET contact_email = lower(btrim(p_new_email)),
      guest_session_revoked_at = coalesce(orders.guest_session_revoked_at, now()),
      updated_at = now()
  WHERE orders.id = p_order_id;

  UPDATE public.guest_order_access_tokens AS token
  SET revoked_at = clock_timestamp()
  WHERE token.order_id = p_order_id AND token.revoked_at IS NULL;

  UPDATE public.guest_order_access_sessions AS session
  SET revoked_at = clock_timestamp()
  WHERE session.order_id = p_order_id AND session.revoked_at IS NULL;

  PERFORM public.queue_guest_order_access(p_order_id, v_event_key, 'Your order contact email was updated. Use this secure link to reopen your order.');

  SELECT mail.to_email AS mail_to_email,
    mail.status AS mail_status,
    coalesce(mail.payload->>'receiptOrderId', mail.payload->>'reference')::uuid AS mail_order_id,
    encode(extensions.digest(mail.payload->>'guestAccessToken', 'sha256'), 'hex') AS mail_token_hash,
    length(mail.payload->>'guestAccessToken') AS guest_token_length
  INTO v_mail
  FROM public.email_outbox AS mail
  WHERE mail.event_key = v_event_key;

  IF NOT FOUND OR v_mail.mail_to_email IS DISTINCT FROM lower(btrim(p_new_email)) OR v_mail.mail_status <> 'pending'
    OR v_mail.guest_token_length <> 43 THEN
    RAISE EXCEPTION 'guest_contact_mail_enqueue_failed' USING ERRCODE = '55000';
  END IF;

  v_mail_order_id := v_mail.mail_order_id;
  v_token_hash := v_mail.mail_token_hash;
  IF v_mail_order_id IS DISTINCT FROM p_order_id OR v_token_hash IS NULL THEN
    RAISE EXCEPTION 'guest_contact_mail_enqueue_failed' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_token_count
  FROM public.guest_order_access_tokens AS token
  WHERE token.order_id = p_order_id
    AND token.token_hash = v_token_hash
    AND token.consumed_at IS NULL
    AND token.revoked_at IS NULL
    AND token.expires_at > clock_timestamp();

  SELECT count(*) INTO v_mail_count_after
  FROM public.email_outbox AS mail
  WHERE mail.event_key = v_event_key
    AND mail.to_email = lower(btrim(p_new_email))
    AND mail.status = 'pending';

  IF v_token_count <> 1 OR v_mail_count_after <> 1 THEN
    RAISE EXCEPTION 'guest_contact_mail_enqueue_failed' USING ERRCODE = '55000';
  END IF;

  INSERT INTO app_private.guest_contact_corrections(
    request_id, order_id, actor_id, support_ticket_id, evidence_kind, payment_id,
    input_fingerprint, old_email_hash, new_email_hash,
    old_email_masked, new_email_masked, event_key
  ) VALUES (
    p_request_id, p_order_id, v_actor, p_support_ticket_id, p_evidence_kind, p_payment_id,
    v_input_fingerprint,
    encode(extensions.digest(lower(v_order.contact_email), 'sha256'), 'hex'),
    encode(extensions.digest(lower(btrim(p_new_email)), 'sha256'), 'hex'),
    left(split_part(v_order.contact_email, '@', 1), 1) || '***@' || split_part(v_order.contact_email, '@', 2),
    left(split_part(lower(btrim(p_new_email)), '@', 1), 1) || '***@' || split_part(lower(btrim(p_new_email)), '@', 2),
    v_event_key
  );

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (
    v_actor,
    'guest_order.contact_email.corrected',
    'order',
    p_order_id,
    jsonb_build_object('contactEmail', left(split_part(v_order.contact_email, '@', 1), 1) || '***@' || split_part(v_order.contact_email, '@', 2)),
    jsonb_build_object('contactEmail', left(split_part(lower(btrim(p_new_email)), '@', 1), 1) || '***@' || split_part(lower(btrim(p_new_email)), '@', 2), 'requestId', p_request_id),
    'Support case ' || p_support_ticket_id::text || '; evidence: ' || p_evidence_kind
  );

  RETURN jsonb_build_object('orderId', p_order_id, 'orderReference', v_order.display_id, 'delivery', 'queued', 'replayed', false);
END;
$function$;

-- Keep old subject cookies revoked while permitting only credentials minted
-- after the contact correction's revocation boundary.
CREATE OR REPLACE FUNCTION public.resume_guest_order_access(p_token_hash text, p_session_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order_id uuid;
  v_revoked_at timestamptz;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' OR p_session_hash !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  SELECT token.order_id INTO v_order_id
  FROM public.guest_order_access_tokens AS token WHERE token.token_hash = p_token_hash;
  IF v_order_id IS NULL THEN RETURN NULL; END IF;

  SELECT orders.guest_session_revoked_at INTO v_revoked_at
  FROM public.orders AS orders
  WHERE orders.id = v_order_id AND orders.user_id IS NULL AND orders.guest_subject_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM 1 FROM public.guest_order_access_tokens AS token
  WHERE token.order_id = v_order_id AND token.token_hash = p_token_hash
    AND token.consumed_at IS NOT NULL AND token.revoked_at IS NULL
    AND token.expires_at > clock_timestamp()
    AND (v_revoked_at IS NULL OR token.created_at >= v_revoked_at)
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM 1 FROM public.guest_order_access_sessions AS session
  WHERE session.order_id = v_order_id AND session.token_hash = p_session_hash
    AND session.revoked_at IS NULL AND session.expires_at > clock_timestamp()
    AND (v_revoked_at IS NULL OR session.created_at >= v_revoked_at)
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.exchange_guest_order_access(p_token_hash text, p_session_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order_id uuid;
  v_revoked_at timestamptz;
  v_token_id uuid;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' OR p_session_hash !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  SELECT token.order_id INTO v_order_id
  FROM public.guest_order_access_tokens AS token WHERE token.token_hash = p_token_hash;
  IF v_order_id IS NULL THEN RETURN NULL; END IF;

  SELECT orders.guest_session_revoked_at INTO v_revoked_at
  FROM public.orders AS orders
  WHERE orders.id = v_order_id AND orders.user_id IS NULL AND orders.guest_subject_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.guest_order_access_tokens AS token
  SET consumed_at = clock_timestamp()
  WHERE token.order_id = v_order_id AND token.token_hash = p_token_hash
    AND token.consumed_at IS NULL AND token.revoked_at IS NULL
    AND token.expires_at > clock_timestamp()
    AND (v_revoked_at IS NULL OR token.created_at >= v_revoked_at)
  RETURNING token.id INTO v_token_id;
  IF v_token_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.guest_order_access_sessions(order_id, token_hash, expires_at)
  VALUES(v_order_id, p_session_hash, clock_timestamp() + interval '24 hours');
  RETURN v_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_guest_order_contact(uuid, uuid, text, text, uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.correct_guest_order_contact(uuid, uuid, text, text, uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.inspect_email_outbox_delivery()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM app_private.require_email_delivery_service();
  RETURN jsonb_build_object(
    'counts', (
      SELECT jsonb_object_agg(state, n)
      FROM (
        SELECT CASE WHEN status = 'failed' AND attempts >= 5 AND delivery_state = 'ready' THEN 'exhausted' ELSE delivery_state END AS state, count(*) AS n
        FROM public.email_outbox
        WHERE status <> 'cancelled'
        GROUP BY 1
      ) AS counts
    ),
    'attention', coalesce((
      SELECT jsonb_agg(to_jsonb(queue))
      FROM (
        SELECT id, event_type, status, delivery_state, attempts, lease_token, smtp_message_id, updated_at
        FROM public.email_outbox
        WHERE status NOT IN ('sent','cancelled')
          AND (delivery_state = 'unknown' OR attempts >= 5)
        ORDER BY updated_at
        LIMIT 100
      ) AS queue
    ), '[]'::jsonb)
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
