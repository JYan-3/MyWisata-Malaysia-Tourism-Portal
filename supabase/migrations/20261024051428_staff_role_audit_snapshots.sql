-- Extend the existing protected role update with before/after authorization
-- snapshots. The seven-argument optimistic-lock wrapper and its ACL are unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION app_private.update_staff_role_with_modules(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_module_keys text[],
  p_active boolean,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_role public.staff_roles%ROWTYPE;
  v_module_keys text[];
  v_before_module_keys text[];
  v_before_permission_keys text[];
  v_permission_keys text[];
BEGIN
  v_actor := public.require_active_global_staff_super_admin();
  PERFORM public.validate_staff_reason(p_reason);
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'staff_role_name_required';
  END IF;
  IF p_description IS NOT NULL AND char_length(btrim(p_description)) > 1000 THEN
    RAISE EXCEPTION 'staff_role_description_too_long';
  END IF;
  IF p_active IS NULL THEN RAISE EXCEPTION 'staff_role_active_required'; END IF;

  SELECT * INTO v_role FROM public.staff_roles WHERE id = p_role_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_role_not_found'; END IF;
  IF v_role.is_system THEN RAISE EXCEPTION 'system_role_protected'; END IF;

  v_module_keys := public.validate_staff_module_keys(p_module_keys);
  SELECT coalesce(array_agg(module_row.key ORDER BY module_row.key), ARRAY[]::text[])
    INTO v_before_module_keys
    FROM public.staff_role_modules AS role_module
    JOIN public.staff_modules AS module_row ON module_row.id = role_module.module_id
   WHERE role_module.role_id = p_role_id;
  SELECT coalesce(array_agg(permission.key ORDER BY permission.key), ARRAY[]::text[])
    INTO v_before_permission_keys
    FROM public.staff_role_permissions AS role_permission
    JOIN public.staff_permissions AS permission ON permission.id = role_permission.permission_id
   WHERE role_permission.role_id = p_role_id;

  UPDATE public.staff_roles
     SET name = btrim(p_name), description = nullif(btrim(p_description), ''),
         is_active = p_active, updated_at = now()
   WHERE id = p_role_id;

  DELETE FROM public.staff_role_modules WHERE role_id = p_role_id;
  INSERT INTO public.staff_role_modules(role_id, module_id)
  SELECT p_role_id, module_row.id FROM public.staff_modules AS module_row
   WHERE module_row.key = ANY(v_module_keys);
  PERFORM public.sync_staff_role_permissions(p_role_id);

  SELECT coalesce(array_agg(permission.key ORDER BY permission.key), ARRAY[]::text[])
    INTO v_permission_keys
    FROM public.staff_role_permissions AS role_permission
    JOIN public.staff_permissions AS permission ON permission.id = role_permission.permission_id
   WHERE role_permission.role_id = p_role_id;

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (
    v_actor, 'staff.role.updated', 'staff_role', p_role_id,
    jsonb_build_object(
      'roleName', v_role.name,
      'moduleKeys', v_before_module_keys,
      'permissionKeys', v_before_permission_keys,
      'isActive', v_role.is_active
    ),
    jsonb_build_object(
      'roleName', btrim(p_name),
      'moduleKeys', v_module_keys,
      'permissionKeys', v_permission_keys,
      'isActive', p_active
    ),
    btrim(p_reason)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
