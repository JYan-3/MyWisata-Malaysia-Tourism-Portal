-- Reviewer MFA is enforced inside the database as well as the application.
-- Apply after the compatible MFA setup UI has been deployed.
CREATE OR REPLACE FUNCTION app_private.require_kyc_aal2()
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'kyc_mfa_required';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_private.require_kyc_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.require_kyc_aal2() TO authenticated, service_role;

-- Assignment overrides belong only to active global Super Admins.
CREATE FUNCTION app_private.is_kyc_review_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u
    JOIN public.user_roles ur ON ur.user_id=u.id JOIN public.roles r ON r.id=ur.role_id
    WHERE u.id=(SELECT auth.uid()) AND u.status='active' AND r.name='super_admin'
      AND ur.vendor_id IS NULL AND ur.outlet_id IS NULL);
$$;
REVOKE ALL ON FUNCTION app_private.is_kyc_review_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.is_kyc_review_super_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.claim_kyc_submission(p_submission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_id UUID := auth.uid();
  v_submission public.kyc_submissions%ROWTYPE;
  v_can_decide BOOLEAN;
BEGIN
  PERFORM app_private.require_kyc_aal2();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT public.has_staff_permission(v_actor_id, 'admin.kyc.review') THEN RAISE EXCEPTION 'kyc_reviewer_required'; END IF;

  SELECT * INTO v_submission
    FROM public.kyc_submissions
   WHERE id = p_submission_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'kyc_not_found'; END IF;

  IF v_submission.status = 'pending' THEN
    UPDATE public.kyc_submissions
       SET assigned_to = auth.uid(), claimed_at = now()
     WHERE id = p_submission_id
       AND assigned_to IS NULL;
    SELECT * INTO v_submission FROM public.kyc_submissions WHERE id = p_submission_id;
  END IF;

  v_can_decide := v_submission.status = 'pending'
    AND (v_submission.assigned_to = v_actor_id OR app_private.is_kyc_review_super_admin());

  RETURN jsonb_build_object(
    'assignedTo', v_submission.assigned_to,
    'claimedAt', v_submission.claimed_at,
    'isAssignedToActor', v_submission.assigned_to = v_actor_id,
    'canDecide', v_can_decide
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION app_private.admin_review_kyc(p_submission_id uuid, p_user_id uuid, p_action text, p_reason_code text DEFAULT NULL::text, p_reason_detail text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_submission public.kyc_submissions%ROWTYPE;
  v_status TEXT;
  v_actor_role TEXT;
  v_customer_message TEXT;
  v_reviewed_at TIMESTAMPTZ := NOW();
BEGIN
  PERFORM app_private.require_kyc_aal2();
  IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(), 'admin.kyc.review') THEN
    RAISE EXCEPTION 'kyc_permission_required';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject', 'request_info') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF auth.uid() = p_user_id THEN
    RAISE EXCEPTION 'self_dealing';
  END IF;
  IF p_action = 'approve' AND (p_reason_code IS NOT NULL OR p_reason_detail IS NOT NULL) THEN
    RAISE EXCEPTION 'reason_not_allowed';
  END IF;
  IF p_action <> 'approve' AND (
    p_reason_code IS NULL
    OR p_reason_code NOT IN (
      'document_unreadable',
      'document_incomplete',
      'document_mismatch',
      'document_expired',
      'document_suspected_tampering',
      'other'
    )
  ) THEN
    RAISE EXCEPTION 'invalid_reason_code';
  END IF;
  IF p_action = 'request_info' AND p_reason_code = 'document_suspected_tampering' THEN
    RAISE EXCEPTION 'reason_code_not_allowed';
  END IF;
  IF p_reason_code <> 'other' AND p_reason_detail IS NOT NULL THEN
    RAISE EXCEPTION 'reason_detail_not_allowed';
  END IF;
  IF p_reason_code = 'other'
     AND char_length(BTRIM(COALESCE(p_reason_detail, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_detail_too_short';
  END IF;

  SELECT *
    INTO v_submission
    FROM public.kyc_submissions
   WHERE id = p_submission_id
     AND user_id = p_user_id
     AND status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kyc_not_active_or_not_found';
  END IF;
  IF NOT app_private.is_kyc_review_super_admin()
     AND v_submission.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'kyc_not_assigned';
  END IF;

  SELECT role_row.name
    INTO v_actor_role
    FROM public.user_roles AS assignment
    JOIN public.roles AS role_row ON role_row.id = assignment.role_id
   WHERE assignment.user_id = auth.uid()
     AND assignment.vendor_id IS NULL
     AND assignment.outlet_id IS NULL
     AND role_row.name IN ('admin', 'approver', 'staff', 'super_admin')
   ORDER BY CASE role_row.name
     WHEN 'super_admin' THEN 0
     WHEN 'admin' THEN 1
     ELSE 2
   END
   LIMIT 1;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'kyc_permission_required';
  END IF;

  v_status := CASE p_action
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
    ELSE 'info_requested'
  END;
  v_customer_message := CASE p_action
    WHEN 'approve' THEN 'Your identity verification is complete.'
    WHEN 'reject' THEN 'Your KYC submission was rejected. Review the reason and submit new evidence if needed.'
    ELSE 'Additional KYC information is required. Review the request and submit new evidence.'
  END;

  UPDATE public.kyc_submissions
     SET status = v_status,
         reviewed_at = v_reviewed_at,
         reviewer_id = auth.uid(),
         evidence_retention_started_at = CASE
           WHEN p_action = 'reject' THEN v_reviewed_at
           ELSE evidence_retention_started_at
         END,
         review_reason_code = CASE WHEN p_action = 'approve' THEN NULL ELSE p_reason_code END,
         review_reason_detail = CASE
           WHEN p_action = 'approve' THEN NULL
           ELSE NULLIF(BTRIM(p_reason_detail), '')
         END
   WHERE id = p_submission_id;

  PERFORM set_config('app.allow_verification_write', 'on', TRUE);
  UPDATE public.users
     SET kyc_status = CASE
           WHEN p_action = 'approve' THEN 'approved'
           WHEN p_action = 'reject' THEN 'rejected'
           ELSE 'pending'
         END,
         updated_at = NOW()
   WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
  PERFORM public.recompute_compatibility_tier(p_user_id);

  INSERT INTO public.kyc_review_events(
    submission_id,
    user_id,
    from_status,
    to_status,
    action,
    actor_id,
    actor_role,
    reason_category,
    internal_note,
    customer_message,
    created_at
  ) VALUES (
    p_submission_id,
    p_user_id,
    v_submission.status,
    v_status,
    p_action,
    auth.uid(),
    v_actor_role,
    CASE WHEN p_action = 'approve' THEN NULL ELSE p_reason_code END,
    CASE WHEN p_action = 'approve' THEN NULL ELSE NULLIF(BTRIM(p_reason_detail), '') END,
    v_customer_message,
    v_reviewed_at
  );

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, after_data, note)
  VALUES (
    auth.uid(),
    'kyc.' || p_action,
    'kyc_submission',
    p_submission_id,
    jsonb_build_object(
      'submission_id', p_submission_id,
      'reason_code', CASE WHEN p_action = 'approve' THEN NULL ELSE p_reason_code END
    ),
    CASE WHEN p_reason_code = 'other' THEN NULLIF(BTRIM(p_reason_detail), '') ELSE NULL END
  );

  INSERT INTO public.notifications(user_id, type, title, body, link)
  VALUES (
    p_user_id,
    'kyc_' || p_action,
    CASE p_action
      WHEN 'approve' THEN 'KYC verification approved'
      WHEN 'reject' THEN 'KYC submission rejected'
      ELSE 'Additional KYC information needed'
    END,
    v_customer_message,
    '/customer/kyc'
  );
END;
$function$
;

DROP POLICY IF EXISTS kyc_select_own ON public.kyc_submissions;
CREATE POLICY kyc_select_own ON public.kyc_submissions FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR ((SELECT auth.jwt() ->> 'aal') = 'aal2' AND public.has_staff_permission((SELECT auth.uid()), 'admin.kyc.review'))
);

-- This unused legacy mutator bypasses modern assignment and review rules.
REVOKE ALL ON FUNCTION public.review_kyc(uuid, uuid, character varying, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.review_kyc(uuid, uuid, character varying, text) FROM PUBLIC, anon, authenticated, service_role;
