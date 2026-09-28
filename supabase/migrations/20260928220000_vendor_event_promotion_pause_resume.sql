-- Vendor Event Promotion — admin manual pause/resume for paid promotions.
--
-- Today a promotion's public visibility is entirely date/status driven:
-- once paid, it's live for its whole date range with no way for admin to
-- take it down early or bring a paused one back without waiting out the
-- dates. Add a `paused` status admin can toggle to/from `paid` at will.
--
-- `paused` sits outside the public RLS read policy's `status = 'paid'`
-- branch, so a paused promotion is automatically hidden from customers —
-- no RLS change needed. Admin/vendor-owner/outlet-manager can still see it
-- via the existing OR-branches.

-- ── Allow 'paused' as a status value ─────────────────────────────────────
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
   WHERE con.conrelid = 'public.vendor_event_promotions'::regclass
     AND con.contype = 'c'
     AND att.attname = 'status';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.vendor_event_promotions DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.vendor_event_promotions ADD CONSTRAINT vendor_event_promotions_status_check
  CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'changes_requested', 'paused'));

-- ── Allow 'pause'/'resume' as review-event action values ─────────────────
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
   WHERE con.conrelid = 'public.vendor_event_promotion_review_events'::regclass
     AND con.contype = 'c'
     AND att.attname = 'action';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.vendor_event_promotion_review_events DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.vendor_event_promotion_review_events ADD CONSTRAINT vendor_event_promotion_review_events_action_check
  CHECK (action IN ('approve', 'reject', 'request_changes', 'resubmit', 'pay', 'pause', 'resume'));

-- ── RPC: set_vendor_event_promotion_visibility ────────────────────────────
-- Admin-only toggle between 'paid' (visible) and 'paused' (hidden). Resume
-- re-runs the exact same capacity check as approve (a day may have filled
-- up while this promotion was paused) and refuses to resume a promotion
-- whose date range has already ended.

CREATE OR REPLACE FUNCTION public.set_vendor_event_promotion_visibility(
  p_promotion_id UUID,
  p_action TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from_status TEXT;
  v_starts_on DATE;
  v_ends_on DATE;
  v_to_status TEXT;
  v_max_concurrent INT;
  v_max_overlap INT;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF p_action NOT IN ('pause', 'resume') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT status, starts_on, ends_on INTO v_from_status, v_starts_on, v_ends_on
    FROM public.vendor_event_promotions
   WHERE id = p_promotion_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF p_action = 'pause' THEN
    IF v_from_status != 'paid' THEN RAISE EXCEPTION 'not_paid'; END IF;
    v_to_status := 'paused';
  ELSE
    IF v_from_status != 'paused' THEN RAISE EXCEPTION 'not_paused'; END IF;
    IF v_ends_on < CURRENT_DATE THEN RAISE EXCEPTION 'promotion_ended'; END IF;

    PERFORM pg_advisory_xact_lock(hashtext('event_promotion_capacity'));

    SELECT COALESCE(value::INT, 4) INTO v_max_concurrent
      FROM public.platform_settings WHERE key = 'event_promotion.max_concurrent';
    v_max_concurrent := COALESCE(v_max_concurrent, 4);

    SELECT COALESCE(MAX(day_count), 0) INTO v_max_overlap
      FROM (
        SELECT COUNT(*) AS day_count
          FROM generate_series(v_starts_on, v_ends_on, interval '1 day') AS d(day)
          JOIN public.vendor_event_promotions p2
            ON p2.id <> p_promotion_id
           AND p2.status IN ('approved', 'paid')
           AND p2.starts_on <= d.day::date
           AND p2.ends_on >= d.day::date
         GROUP BY d.day
      ) counts;

    IF v_max_overlap >= v_max_concurrent THEN
      RAISE EXCEPTION 'capacity_exceeded';
    END IF;

    v_to_status := 'paid';
  END IF;

  UPDATE public.vendor_event_promotions
     SET status = v_to_status,
         updated_at = now()
   WHERE id = p_promotion_id;

  INSERT INTO public.vendor_event_promotion_review_events
    (promotion_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_promotion_id, v_from_status, v_to_status, p_action, auth.uid(), 'admin', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.set_vendor_event_promotion_visibility(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vendor_event_promotion_visibility(UUID, TEXT) TO authenticated;
