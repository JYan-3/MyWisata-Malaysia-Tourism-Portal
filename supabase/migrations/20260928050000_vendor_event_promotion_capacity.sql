-- Vendor Event Promotion — concurrent-promotion capacity cap.
-- See Docs/plans/2026-09-28-0530-event-promotion-capacity-calendar.md.
--
-- Only `approved`/`paid` promotions occupy a day (a `pending` submission
-- doesn't reserve anything) — so the cap is enforced at APPROVE time, not
-- at submission. The vendor-facing calendar (fed by the read-only RPC
-- below) is a soft UX hint only; this is the real, server-side gate.

INSERT INTO public.platform_settings (key, value, description)
VALUES ('event_promotion.max_concurrent', '4', 'Maximum number of vendor event promotions that may be approved/live on any single day.')
ON CONFLICT (key) DO NOTHING;

-- ── review_vendor_event_promotion: add a capacity check to `approve` ─────
-- Same (UUID, TEXT, TEXT) signature as the original — CREATE OR REPLACE is
-- a true replace here, no overload-drift risk (unlike resubmit's earlier
-- signature change).
--
-- ponytail: a single global advisory lock serializes every approval
-- capacity-check against every other one. Correct and simple at expected
-- admin-review volume; move to per-range locking only if approvals ever
-- become high-throughput.

CREATE OR REPLACE FUNCTION public.review_vendor_event_promotion(
  p_promotion_id UUID,
  p_action TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from_status TEXT;
  v_to_status TEXT;
  v_starts_on DATE;
  v_ends_on DATE;
  v_max_concurrent INT;
  v_max_overlap INT;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF p_action NOT IN ('approve', 'reject', 'request_changes') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF p_action IN ('reject', 'request_changes') AND char_length(BTRIM(COALESCE(p_note, ''))) < 10 THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  SELECT status, starts_on, ends_on INTO v_from_status, v_starts_on, v_ends_on
    FROM public.vendor_event_promotions
   WHERE id = p_promotion_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_from_status != 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  IF p_action = 'approve' THEN
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
  END IF;

  v_to_status := CASE p_action
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
    ELSE 'changes_requested'
  END;

  UPDATE public.vendor_event_promotions
     SET status = v_to_status,
         reviewer_id = auth.uid(),
         reviewed_at = now(),
         rejection_reason = CASE WHEN p_action = 'reject' THEN BTRIM(p_note) ELSE NULL END,
         changes_requested_at = CASE WHEN p_action = 'request_changes' THEN now() ELSE NULL END,
         changes_requested_reason = CASE WHEN p_action = 'request_changes' THEN BTRIM(p_note) ELSE NULL END,
         updated_at = now()
   WHERE id = p_promotion_id;

  INSERT INTO public.vendor_event_promotion_review_events
    (promotion_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_promotion_id, v_from_status, v_to_status, p_action, auth.uid(), 'admin', p_note);
END;
$$;

REVOKE ALL ON FUNCTION public.review_vendor_event_promotion(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_vendor_event_promotion(UUID, TEXT, TEXT) TO authenticated;

-- ── Read-only availability RPC (vendor-facing calendar hint) ─────────────
-- SECURITY DEFINER because a vendor's own RLS read policy can't see other
-- vendors' `approved` rows (only `paid`/public, or their own) — but this
-- only ever returns an aggregate count per day, never which vendor or
-- promotion holds a slot, so it's safe to expose broadly to any signed-in
-- user. Range is clamped server-side to guard against a pathological
-- request driving a huge generate_series.

CREATE OR REPLACE FUNCTION public.get_event_promotion_date_availability(
  p_from DATE,
  p_to DATE
)
RETURNS TABLE(day DATE, occupied_count INT, available BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max_concurrent INT;
BEGIN
  IF p_to < p_from THEN RAISE EXCEPTION 'invalid_range'; END IF;
  IF p_to - p_from > 180 THEN RAISE EXCEPTION 'range_too_large'; END IF;

  SELECT COALESCE(value::INT, 4) INTO v_max_concurrent
    FROM public.platform_settings WHERE key = 'event_promotion.max_concurrent';
  v_max_concurrent := COALESCE(v_max_concurrent, 4);

  RETURN QUERY
  SELECT d.day::date,
         COUNT(p.id)::INT AS occupied_count,
         COUNT(p.id) < v_max_concurrent AS available
    FROM generate_series(p_from, p_to, interval '1 day') AS d(day)
    LEFT JOIN public.vendor_event_promotions p
      ON p.status IN ('approved', 'paid')
     AND p.starts_on <= d.day::date
     AND p.ends_on >= d.day::date
   GROUP BY d.day
   ORDER BY d.day;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_promotion_date_availability(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_promotion_date_availability(DATE, DATE) TO authenticated;
