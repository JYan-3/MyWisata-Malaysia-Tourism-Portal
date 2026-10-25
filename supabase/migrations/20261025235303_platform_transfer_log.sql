-- Platform funds panel and transfer log (Docs/plans/2026-10-25-2353-platform-funds-transfer-log.md).
--
-- Customer payments already land in the company's own accounts; the platform's share is only a
-- number on each settlement. This adds a read-only summary of money still owed to others and an
-- append-only log of platform earnings that finance moved to the company's operating account.
-- Recording a transfer moves no money in the app. It is Super Admin only (public.is_super_admin
-- already requires the staff AAL2 and passkey assurance) and is blocked above what the platform
-- has earned on confirmed settlements, serialised so two admins cannot both pass the check.

CREATE TABLE app_private.platform_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_sen bigint NOT NULL CHECK (amount_sen > 0 AND amount_sen <= 1000000000),
  transferred_on date NOT NULL,
  reference text NOT NULL CHECK (char_length(btrim(reference)) BETWEEN 3 AND 120),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  void_reason text CHECK (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 5 AND 500),
  CONSTRAINT platform_transfers_void_complete CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
  )
);
ALTER TABLE app_private.platform_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.platform_transfers FROM PUBLIC, anon, authenticated;
CREATE INDEX platform_transfers_created_at_idx ON app_private.platform_transfers (created_at DESC);

-- Platform net on confirmed settlements, using the same rule as Order Breakdown
-- (lib/admin/reconciliation.ts): platform fee - affiliate commissions (not reversed/rejected)
-- - recommendation commissions (not reversed), RM amounts rounded to sen.
CREATE FUNCTION app_private.platform_earned_confirmed_sen()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH confirmed AS (
    SELECT order_id, sum(platform_fee_sen) AS fee_sen
      FROM public.order_settlements
     WHERE status = 'confirmed'
     GROUP BY order_id
  ), affiliate AS (
    SELECT a.order_id, sum(round(a.commission_amount * 100)) AS amount_sen
      FROM public.affiliate_attributions a
      JOIN confirmed c ON c.order_id = a.order_id
     WHERE a.status NOT IN ('reversed', 'rejected')
     GROUP BY a.order_id
  ), recommendation AS (
    SELECT r.order_id, sum(round(r.amount * 100)) AS amount_sen
      FROM public.recommendation_commissions r
      JOIN confirmed c ON c.order_id = r.order_id
     WHERE r.status <> 'reversed'
     GROUP BY r.order_id
  )
  SELECT coalesce(sum(c.fee_sen - coalesce(a.amount_sen, 0) - coalesce(r.amount_sen, 0)), 0)::bigint
    FROM confirmed c
    LEFT JOIN affiliate a ON a.order_id = c.order_id
    LEFT JOIN recommendation r ON r.order_id = c.order_id;
$$;

CREATE FUNCTION app_private.platform_transferred_sen()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(sum(amount_sen), 0)::bigint FROM app_private.platform_transfers WHERE voided_at IS NULL;
$$;

CREATE FUNCTION app_private.get_platform_funds()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owed jsonb;
  v_earned bigint;
  v_transferred bigint;
  v_transfers jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'platform_funds_super_admin_required';
  END IF;

  SELECT jsonb_build_object(
           'readyToWithdrawSen', coalesce(sum(w.earnings_sen), 0),
           'onHoldSen', coalesce(sum(w.pending_earnings_sen), 0),
           'withdrawalsInProgressSen', coalesce(sum(w.reserved_earnings_sen), 0),
           'customerTopUpSen', coalesce(sum(w.topup_sen), 0),
           'refundsPendingSen', (SELECT coalesce(sum(round(f.amount * 100)), 0) FROM public.refunds f WHERE f.status IN ('pending', 'approved'))
         )
    INTO v_owed
    FROM public.wallets w;
  v_owed := v_owed || jsonb_build_object('totalSen',
    (v_owed->>'readyToWithdrawSen')::bigint + (v_owed->>'onHoldSen')::bigint
    + (v_owed->>'withdrawalsInProgressSen')::bigint + (v_owed->>'customerTopUpSen')::bigint
    + (v_owed->>'refundsPendingSen')::bigint);

  v_earned := app_private.platform_earned_confirmed_sen();
  v_transferred := app_private.platform_transferred_sen();

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'amountSen', t.amount_sen, 'transferredOn', t.transferred_on,
           'reference', t.reference, 'note', t.note, 'createdAt', t.created_at,
           'recordedBy', coalesce(nullif(btrim(u.full_name), ''), u.display_name, u.email),
           'voidedAt', t.voided_at, 'voidReason', t.void_reason
         ) ORDER BY t.created_at DESC), '[]'::jsonb)
    INTO v_transfers
    FROM (SELECT * FROM app_private.platform_transfers ORDER BY created_at DESC LIMIT 50) t
    LEFT JOIN public.users u ON u.id = t.recorded_by;

  RETURN jsonb_build_object(
    'owed', v_owed,
    'earnedConfirmedSen', v_earned,
    'transferredSen', v_transferred,
    'availableSen', greatest(v_earned - v_transferred, 0),
    'transfers', v_transfers
  );
END;
$$;

CREATE FUNCTION app_private.record_platform_transfer(p_amount_sen bigint, p_transferred_on date, p_reference text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_available bigint;
  v_row app_private.platform_transfers%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'platform_funds_super_admin_required';
  END IF;
  IF p_amount_sen IS NULL OR p_amount_sen <= 0 OR p_amount_sen > 1000000000
     OR p_transferred_on IS NULL OR p_transferred_on > (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
     OR p_reference IS NULL OR char_length(btrim(p_reference)) NOT BETWEEN 3 AND 120
     OR char_length(coalesce(p_note, '')) > 500 THEN
    RAISE EXCEPTION 'platform_transfer_invalid';
  END IF;

  -- Serialise the availability check with the insert across concurrent recorders.
  PERFORM pg_advisory_xact_lock(hashtext('app_private.platform_transfers'));
  v_available := app_private.platform_earned_confirmed_sen() - app_private.platform_transferred_sen();
  IF p_amount_sen > v_available THEN
    RAISE EXCEPTION 'platform_transfer_exceeds_available';
  END IF;

  INSERT INTO app_private.platform_transfers (amount_sen, transferred_on, reference, note, recorded_by)
  VALUES (p_amount_sen, p_transferred_on, btrim(p_reference), nullif(btrim(coalesce(p_note, '')), ''), v_actor)
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  VALUES (v_actor, 'platform_transfer.recorded', 'platform_transfer', v_row.id,
    jsonb_build_object('amountSen', v_row.amount_sen, 'transferredOn', v_row.transferred_on,
      'reference', v_row.reference, 'availableBeforeSen', v_available));

  RETURN jsonb_build_object('id', v_row.id, 'amountSen', v_row.amount_sen, 'availableSen', v_available - v_row.amount_sen);
END;
$$;

CREATE FUNCTION app_private.void_platform_transfer(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row app_private.platform_transfers%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'platform_funds_super_admin_required';
  END IF;
  IF p_id IS NULL OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'platform_transfer_invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('app_private.platform_transfers'));
  UPDATE app_private.platform_transfers
     SET voided_at = now(), voided_by = v_actor, void_reason = btrim(p_reason)
   WHERE id = p_id AND voided_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_transfer_not_found';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (v_actor, 'platform_transfer.voided', 'platform_transfer', v_row.id,
    jsonb_build_object('amountSen', v_row.amount_sen, 'reference', v_row.reference),
    jsonb_build_object('voidedAt', v_row.voided_at), v_row.void_reason);

  RETURN jsonb_build_object('id', v_row.id, 'voidedAt', v_row.voided_at);
END;
$$;

CREATE FUNCTION public.get_platform_funds() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.get_platform_funds() $$;
CREATE FUNCTION public.record_platform_transfer(p_amount_sen bigint, p_transferred_on date, p_reference text, p_note text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.record_platform_transfer(p_amount_sen, p_transferred_on, p_reference, p_note) $$;
CREATE FUNCTION public.void_platform_transfer(p_id uuid, p_reason text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.void_platform_transfer(p_id, p_reason) $$;

-- Helpers stay private; only the checked entry points are callable, and only when signed in.
REVOKE ALL ON FUNCTION app_private.platform_earned_confirmed_sen(), app_private.platform_transferred_sen()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.get_platform_funds(),
  app_private.record_platform_transfer(bigint, date, text, text),
  app_private.void_platform_transfer(uuid, text),
  public.get_platform_funds(),
  public.record_platform_transfer(bigint, date, text, text),
  public.void_platform_transfer(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_platform_funds(),
  app_private.record_platform_transfer(bigint, date, text, text),
  app_private.void_platform_transfer(uuid, text),
  public.get_platform_funds(),
  public.record_platform_transfer(bigint, date, text, text),
  public.void_platform_transfer(uuid, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
