-- Vendor-fair events have a single operator (Super Admin) with no separate
-- reviewer role, so the "creator cannot approve their own campaign" dual-
-- control guard added in 20260925143000_promotion_campaigns.sql only forced
-- busywork (an admin had to ask another admin to click "approve"). Remove
-- it; every transition is still gated by admin.promotion_campaign.manage,
-- still goes through this SECURITY DEFINER RPC with FOR UPDATE row locking,
-- and still writes an audit_logs row. Same (UUID, TEXT, TIMESTAMPTZ, TEXT)
-- signature — true CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.transition_promotion_campaign(
  p_campaign_id UUID,
  p_action TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_campaign public.promotion_campaigns%ROWTYPE;
  v_before JSONB;
  v_next_status TEXT;
BEGIN
  IF v_actor IS NULL OR NOT public.has_staff_permission(v_actor, 'admin.promotion_campaign.manage') THEN
    RAISE EXCEPTION 'promotion_campaign_permission_required';
  END IF;
  IF p_action NOT IN ('submit', 'approve', 'reject', 'pause', 'resume', 'archive')
     OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'promotion_campaign_invalid_transition';
  END IF;
  IF p_action = 'reject' AND char_length(btrim(coalesce(p_note, ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'promotion_campaign_rejection_note_required';
  END IF;

  SELECT * INTO v_campaign
    FROM public.promotion_campaigns
   WHERE id = p_campaign_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_not_found'; END IF;
  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'promotion_campaign_stale';
  END IF;
  v_before := to_jsonb(v_campaign);

  IF p_action = 'submit' AND v_campaign.status IN ('draft', 'rejected') THEN
    v_next_status := 'pending_approval';
  ELSIF p_action = 'approve' AND v_campaign.status = 'pending_approval' THEN
    v_next_status := 'approved';
  ELSIF p_action = 'reject' AND v_campaign.status = 'pending_approval' THEN
    v_next_status := 'rejected';
  ELSIF p_action = 'pause' AND v_campaign.status = 'approved' THEN
    v_next_status := 'paused';
  ELSIF p_action = 'resume' AND v_campaign.status = 'paused' AND v_campaign.ends_at > now() THEN
    v_next_status := 'approved';
  ELSIF p_action = 'archive' AND v_campaign.status <> 'archived' THEN
    v_next_status := 'archived';
  ELSE
    RAISE EXCEPTION 'promotion_campaign_invalid_transition';
  END IF;

  IF p_action IN ('submit', 'approve', 'resume') AND (v_campaign.poster_url IS NULL OR btrim(v_campaign.poster_url) = '') THEN
    RAISE EXCEPTION 'promotion_campaign_poster_required';
  END IF;

  UPDATE public.promotion_campaigns
     SET status = v_next_status,
         updated_by = v_actor,
         updated_at = now(),
         approved_by = CASE WHEN p_action = 'approve' THEN v_actor WHEN p_action = 'submit' THEN NULL ELSE approved_by END,
         approved_at = CASE WHEN p_action = 'approve' THEN now() WHEN p_action = 'submit' THEN NULL ELSE approved_at END,
         rejection_note = CASE WHEN p_action = 'reject' THEN btrim(p_note) WHEN p_action IN ('submit', 'approve') THEN NULL ELSE rejection_note END
   WHERE id = v_campaign.id
   RETURNING * INTO v_campaign;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (
    v_actor,
    'promotion_campaign.' || p_action,
    'promotion_campaign',
    v_campaign.id,
    v_before,
    jsonb_build_object('status', v_campaign.status, 'slug', v_campaign.slug, 'approvedBy', v_campaign.approved_by),
    nullif(btrim(p_note), '')
  );

  RETURN to_jsonb(v_campaign);
END;
$$;
