-- Make wallet settings + audit atomic and reject stale staff-role edits.
-- The previous role-update signature is revoked so an older client cannot
-- bypass the expected-version check after this migration is installed.

REVOKE ALL ON FUNCTION app_private.update_staff_role_with_modules(uuid, text, text, text[], boolean, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_staff_role_with_modules(uuid, text, text, text[], boolean, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.update_staff_role_with_modules(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_module_keys text[],
  p_active boolean,
  p_expected_updated_at timestamptz,
  p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $function$
DECLARE
  v_current_updated_at timestamptz;
BEGIN
  SELECT updated_at INTO v_current_updated_at FROM public.staff_roles WHERE id = p_role_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_role_not_found'; END IF;
  IF p_expected_updated_at IS NULL OR v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'staff_role_version_conflict';
  END IF;
  PERFORM app_private.update_staff_role_with_modules(p_role_id, p_name, p_description, p_module_keys, p_active, p_reason);
END;
$function$;
REVOKE ALL ON FUNCTION app_private.update_staff_role_with_modules(uuid, text, text, text[], boolean, timestamptz, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.update_staff_role_with_modules(uuid, text, text, text[], boolean, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_staff_role_with_modules(
  p_role_id uuid, p_name text, p_description text, p_module_keys text[], p_active boolean,
  p_expected_updated_at timestamptz, p_reason text
) RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
  SELECT app_private.update_staff_role_with_modules(p_role_id, p_name, p_description, p_module_keys, p_active, p_expected_updated_at, p_reason);
$function$;
REVOKE ALL ON FUNCTION public.update_staff_role_with_modules(uuid, text, text, text[], boolean, timestamptz, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_staff_role_with_modules(uuid, text, text, text[], boolean, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.update_wallet_settings_with_audit(p_settings jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_change jsonb := '{}'::jsonb;
  v_item record;
  v_value bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.is_super_admin(v_actor) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 OR char_length(p_reason) > 500 THEN RAISE EXCEPTION 'staff_reason_required'; END IF;
  IF jsonb_typeof(p_settings) <> 'object' OR p_settings = '{}'::jsonb THEN RAISE EXCEPTION 'settings_invalid'; END IF;
  FOR v_item IN SELECT key, value FROM jsonb_each_text(p_settings) LOOP
    IF v_item.key NOT IN ('wallet.clearance_days','withdrawal.min_amount_sen','withdrawal.dual_approval_threshold_sen','withdrawal.escalation_hours','withdrawal.hold_escalation_hours') THEN
      RAISE EXCEPTION 'setting_not_allowed';
    END IF;
    IF v_item.value !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION 'setting_value_invalid'; END IF;
    v_value := v_item.value::bigint;
    IF (v_item.key = 'wallet.clearance_days' AND v_value NOT BETWEEN 1 AND 30)
      OR (v_item.key = 'withdrawal.min_amount_sen' AND v_value < 100)
      OR (v_item.key = 'withdrawal.escalation_hours' AND v_value NOT BETWEEN 24 AND 168)
      OR (v_item.key = 'withdrawal.hold_escalation_hours' AND v_value NOT BETWEEN 24 AND 720) THEN
      RAISE EXCEPTION 'setting_value_invalid';
    END IF;
    INSERT INTO public.platform_settings(key, value, updated_by)
      VALUES (v_item.key, v_value::text, v_actor)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
    v_change := v_change || jsonb_build_object(v_item.key, v_value);
  END LOOP;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, after_data, note)
    VALUES (v_actor, 'wallet.settings_updated', 'platform_settings', v_actor, v_change, btrim(p_reason));
  RETURN v_change;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.update_wallet_settings_with_audit(jsonb, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.update_wallet_settings_with_audit(jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_wallet_settings_with_audit(p_settings jsonb, p_reason text)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
  SELECT app_private.update_wallet_settings_with_audit(p_settings, p_reason);
$function$;
REVOKE ALL ON FUNCTION public.update_wallet_settings_with_audit(jsonb, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_wallet_settings_with_audit(jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
