-- System-wide emergency controls stay in the existing private settings store.
INSERT INTO public.platform_settings (key, value, description)
VALUES
  ('operations.pause_new_orders', 'false', 'Pause creation of new customer orders'),
  ('email.pause_custom_delivery', 'false', 'Pause custom SMTP delivery while retaining queued messages')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.staff_modules (
  key, label, label_key, description, section_key, section_label,
  section_label_key, section_sort_order, href, icon_key, sort_order, is_system
)
VALUES (
  'system_settings', 'System Settings', 'navigation.System Settings',
  'Manage platform-wide operational controls', 'administration', 'Administration',
  'navigationSections.administration', 60, '/admin/system-settings', 'settings-2', 60, TRUE
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  label_key = EXCLUDED.label_key,
  description = EXCLUDED.description,
  section_key = EXCLUDED.section_key,
  section_label = EXCLUDED.section_label,
  section_label_key = EXCLUDED.section_label_key,
  section_sort_order = EXCLUDED.section_sort_order,
  href = EXCLUDED.href,
  icon_key = EXCLUDED.icon_key,
  sort_order = EXCLUDED.sort_order,
  is_system = TRUE,
  updated_at = now();

-- No legacy-role or permission mapping is added. Dynamic navigation exposes
-- unassigned system modules only to global Super Admins.

CREATE OR REPLACE FUNCTION app_private.platform_operation_enabled(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_value TEXT;
BEGIN
  IF p_key NOT IN ('operations.pause_new_orders', 'email.pause_custom_delivery') THEN
    RAISE EXCEPTION 'platform_operation_setting_not_allowed';
  END IF;

  SELECT setting.value INTO v_value
    FROM public.platform_settings AS setting
   WHERE setting.key = p_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_operation_setting_missing';
  END IF;

  IF lower(v_value) NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'platform_operation_setting_invalid';
  END IF;
  RETURN lower(v_value) = 'true';
END;
$function$;

REVOKE ALL ON FUNCTION app_private.platform_operation_enabled(TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.reject_customer_order_when_paused()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (NEW.user_id IS NOT NULL OR NEW.guest_subject_id IS NOT NULL)
     AND app_private.platform_operation_enabled('operations.pause_new_orders') THEN
    RAISE EXCEPTION 'new_orders_paused';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.reject_customer_order_when_paused() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS reject_customer_order_when_paused ON public.orders;
CREATE TRIGGER reject_customer_order_when_paused
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_customer_order_when_paused();

CREATE OR REPLACE FUNCTION public.set_platform_operations_settings(
  p_pause_new_orders BOOLEAN,
  p_pause_custom_delivery BOOLEAN,
  p_actor_id UUID,
  p_reason TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_before JSONB;
  v_after JSONB;
  v_updated_at TIMESTAMPTZ := now();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_actor_id IS NULL OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'platform_settings_audit_reason_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.users AS app_user
      JOIN public.user_roles AS assignment ON assignment.user_id = app_user.id
      JOIN public.roles AS assigned_role ON assigned_role.id = assignment.role_id
     WHERE app_user.id = p_actor_id
       AND app_user.status = 'active'
       AND assigned_role.name = 'super_admin'
       AND assignment.vendor_id IS NULL
       AND assignment.outlet_id IS NULL
  ) THEN
    RAISE EXCEPTION 'active_global_super_admin_required';
  END IF;

  SELECT jsonb_object_agg(key, value::BOOLEAN) INTO v_before
    FROM public.platform_settings
   WHERE key IN ('operations.pause_new_orders', 'email.pause_custom_delivery');

  INSERT INTO public.platform_settings (key, value, description, updated_by, updated_at)
  VALUES
    ('operations.pause_new_orders', p_pause_new_orders::TEXT, 'Pause creation of new customer orders', p_actor_id, v_updated_at),
    ('email.pause_custom_delivery', p_pause_custom_delivery::TEXT, 'Pause custom SMTP delivery while retaining queued messages', p_actor_id, v_updated_at)
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

  v_after := jsonb_build_object(
    'pauseNewOrders', p_pause_new_orders,
    'pauseCustomDelivery', p_pause_custom_delivery,
    'updatedAt', v_updated_at
  );
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (p_actor_id, 'platform.operations_settings_updated', 'platform_settings', p_actor_id, coalesce(v_before, '{}'::JSONB), v_after, btrim(p_reason));

  RETURN v_updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_platform_operations_settings(BOOLEAN, BOOLEAN, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_operations_settings(BOOLEAN, BOOLEAN, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
