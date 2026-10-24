-- Extend the existing role/assignment model; preserve identities and all history.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;

-- The later AAL2 migration replaced four helper bodies. Preserve both boundaries
-- on clean replay as well as projects where passkey assurance is already present.
DO $$ DECLARE f record; v_body text; BEGIN
  FOR f IN SELECT p.oid,p.prosrc,l.lanname FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='app_private' AND p.proname IN ('is_admin','is_super_admin','is_approver','has_staff_permission')
  LOOP
    IF position('staff_authority_assurance()' in f.prosrc)>0 THEN CONTINUE; END IF;
    IF f.lanname='sql' THEN
      v_body:='SELECT app_private.staff_authority_assurance() AND (' || regexp_replace(btrim(f.prosrc),';\s*$','') || ');';
    ELSIF f.lanname='plpgsql' THEN
      v_body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN IF NOT app_private.staff_authority_assurance() THEN RETURN FALSE; END IF;','i');
    ELSE RAISE EXCEPTION 'unsupported_staff_helper'; END IF;
    EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,v_body);
  END LOOP;
END $$;

-- Keep the established rejection transaction, balances, self-dealing and audit
-- rules; replace only its inconsistent legacy-role authorization predicate.
DO $$ DECLARE v_oid oid; v_source text; BEGIN
  v_oid:='public.reject_wallet_withdrawal_server(uuid,uuid,text,inet,text)'::regprocedure;
  SELECT prosrc INTO v_source FROM pg_proc WHERE oid=v_oid;
  IF position('public.is_approver(p_actor_id)' in v_source)>0 THEN
    EXECUTE replace(pg_get_functiondef(v_oid),v_source,replace(v_source,
      'public.is_approver(p_actor_id)', 'public.has_staff_permission(p_actor_id, ''admin.withdrawal.approve'')'));
  ELSIF position('admin.withdrawal.approve' in v_source)=0 THEN
    RAISE EXCEPTION 'unexpected_withdrawal_rejection_authority';
  END IF;
END $$;

INSERT INTO public.staff_permissions(key,module,action,description,is_system)
VALUES('admin.recommendation.review','recommendation','review','Review customer vendor recommendations',true)
ON CONFLICT(key) DO NOTHING;
INSERT INTO public.staff_module_permissions(module_id,permission_id)
SELECT m.id,p.id FROM public.staff_modules m CROSS JOIN public.staff_permissions p
WHERE m.key='recommendations' AND p.key='admin.recommendation.review'
ON CONFLICT DO NOTHING;
UPDATE public.staff_module_legacy_roles SET grants_permissions=true
WHERE role_name='admin' AND module_id=(SELECT id FROM public.staff_modules WHERE key='recommendations');
CREATE OR REPLACE FUNCTION app_private.can_review_recommendation(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.has_staff_permission(uid,'admin.recommendation.review');
$$;

-- Linking a vendor remains a vendor-management action, not review authority.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app_private' AND p.proname='admin_link_vendor_recommendation'
  LOOP
    IF position('public.can_review_recommendation(auth.uid())' in f.prosrc)>0 THEN
      EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,replace(f.prosrc,
        'public.can_review_recommendation(auth.uid())','public.has_staff_permission(auth.uid(), ''admin.vendor.manage'')'));
    END IF;
  END LOOP;
END $$;

-- A menu without a secured capability must not be offered as a working grant.
-- Governance/system-only modules retain their established SuperAdmin boundary.
DO $$ DECLARE v_oid oid; v_source text; BEGIN
  v_oid:='public.validate_staff_module_keys(text[])'::regprocedure;
  SELECT prosrc INTO v_source FROM pg_proc WHERE oid=v_oid;
  IF position('staff_module_not_delegable' in v_source)=0 THEN
    EXECUTE replace(pg_get_functiondef(v_oid),v_source,regexp_replace(v_source,'\mBEGIN\M',
      'BEGIN IF EXISTS (SELECT 1 FROM public.staff_modules m WHERE m.key = ANY(p_module_keys) AND (m.key IN (''overview'',''access_control'',''user_management'',''wallet_settings'',''wallet_approvers'',''payout_reports'',''reconciliation'',''staff_conduct'',''moderation_words'',''refunds'',''support_tickets'',''chat_reports'',''affiliate'',''chatbot'',''ai_assistant'',''system_settings'') OR NOT EXISTS (SELECT 1 FROM public.staff_module_permissions mp WHERE mp.module_id=m.id))) THEN RAISE EXCEPTION ''staff_module_not_delegable''; END IF;','i'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_private.staff_permission_sources(
  p_user_id uuid, p_excluded_assignment_id uuid DEFAULT NULL
) RETURNS TABLE(permission_key text,source_type text,source_id uuid,source_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH eligible AS (
    SELECT u.id FROM public.users u WHERE u.id=p_user_id AND u.status='active'
    AND EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
      WHERE ur.user_id=u.id AND ur.vendor_id IS NULL AND ur.outlet_id IS NULL
        AND r.name IN ('staff','admin','approver','super_admin'))
  ), coarse AS (
    SELECT r.name FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
    WHERE ur.user_id=p_user_id AND ur.vendor_id IS NULL AND ur.outlet_id IS NULL
      AND EXISTS(SELECT 1 FROM eligible)
  )
  SELECT p.key::text,'super_admin'::text,NULL::uuid,'Super Admin'::text
  FROM public.staff_permissions p WHERE EXISTS(SELECT 1 FROM coarse WHERE name='super_admin')
  UNION
  SELECT DISTINCT p.key::text,'assignment',a.id,r.name::text
  FROM public.staff_role_assignments a JOIN public.staff_roles r ON r.id=a.role_id AND r.is_active
  JOIN public.staff_role_modules rm ON rm.role_id=r.id
  JOIN public.staff_modules m ON m.id=rm.module_id AND m.is_active
  JOIN public.staff_module_permissions mp ON mp.module_id=m.id JOIN public.staff_permissions p ON p.id=mp.permission_id
  WHERE a.user_id=p_user_id AND a.revoked_at IS NULL AND a.id IS DISTINCT FROM p_excluded_assignment_id
    AND EXISTS(SELECT 1 FROM eligible)
  UNION
  SELECT DISTINCT p.key::text,'legacy_role',NULL::uuid,c.name::text
  FROM coarse c JOIN public.staff_module_legacy_roles lr ON lr.role_name=c.name AND lr.grants_permissions
  JOIN public.staff_modules m ON m.id=lr.module_id AND m.is_active
  JOIN public.staff_module_permissions mp ON mp.module_id=m.id JOIN public.staff_permissions p ON p.id=mp.permission_id;
$$;
REVOKE ALL ON FUNCTION app_private.staff_permission_sources(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_staff_employee_access(p_user_id uuid,p_excluded_assignment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_active_global_staff_super_admin();
  IF p_excluded_assignment_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.staff_role_assignments WHERE id=p_excluded_assignment_id AND user_id=p_user_id AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'staff_assignment_not_found'; END IF;
  SELECT jsonb_build_object('id',u.id,'name',COALESCE(u.full_name,u.display_name,u.email),'email',u.email,'status',u.status,
    'coarseRoles',COALESCE((SELECT jsonb_agg(DISTINCT r.name) FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
      WHERE ur.user_id=u.id AND ur.vendor_id IS NULL AND ur.outlet_id IS NULL),'[]'::jsonb),
    'assignments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'roleId',r.id,'roleName',r.name,
      'isSystem',r.is_system,'isActive',r.is_active,'createdAt',a.created_at) ORDER BY a.created_at,a.id)
      FROM public.staff_role_assignments a JOIN public.staff_roles r ON r.id=a.role_id
      WHERE a.user_id=u.id AND a.revoked_at IS NULL),'[]'::jsonb),
    'sources',COALESCE((SELECT jsonb_agg(jsonb_build_object('permissionKey',s.permission_key,'sourceType',s.source_type,
      'sourceId',s.source_id,'sourceName',s.source_name) ORDER BY s.permission_key,s.source_type,s.source_name)
      FROM app_private.staff_permission_sources(u.id,p_excluded_assignment_id) s),'[]'::jsonb)) INTO v_result
  FROM public.users u WHERE u.id=p_user_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'staff_employee_not_found'; END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_staff_employee_access(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_employee_access(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_staff_employees(p_search text DEFAULT '',p_status text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_active_global_staff_super_admin();
  IF p_page IS NULL OR p_page_size IS NULL OR p_page<1 OR p_page>1000000 OR p_page_size NOT IN (25,50,100) OR length(COALESCE(p_search,''))>100
    OR COALESCE(p_status,'') NOT IN ('','active','suspended','deleted') THEN RAISE EXCEPTION 'invalid_staff_employee_query'; END IF;
  WITH filtered AS MATERIALIZED (
    SELECT u.id,u.email,COALESCE(u.full_name,u.display_name,u.email) AS name,u.status FROM public.users u
    WHERE (COALESCE(p_status,'')='' OR u.status=p_status)
    AND (COALESCE(btrim(p_search),'')='' OR position(lower(btrim(p_search)) IN lower(COALESCE(u.full_name,'') || ' ' || COALESCE(u.display_name,'') || ' ' || u.email))>0)
    AND EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
      WHERE ur.user_id=u.id AND ur.vendor_id IS NULL AND ur.outlet_id IS NULL AND r.name IN ('staff','admin','approver','super_admin'))
  ), paged AS (SELECT * FROM filtered ORDER BY name,email,id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size)
  SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'email',x.email,'status',x.status,
      'roles',COALESCE((SELECT jsonb_agg(DISTINCT r.name) FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
        WHERE ur.user_id=x.id AND ur.vendor_id IS NULL AND ur.outlet_id IS NULL),'[]'::jsonb)) ORDER BY x.name,x.email,x.id) FROM paged x),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered),'page',p_page,'pageSize',p_page_size,
    'totalPages',ceil((SELECT count(*) FROM filtered)::numeric/p_page_size)) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.list_staff_employees(text,text,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_staff_employees(text,text,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';

-- Match the repository's invoker facade / private governed implementation seam.
ALTER FUNCTION public.get_staff_employee_access(uuid,uuid) SET SCHEMA app_private;
CREATE FUNCTION public.get_staff_employee_access(p_user_id uuid,p_excluded_assignment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT app_private.get_staff_employee_access(p_user_id,p_excluded_assignment_id);
$$;
ALTER FUNCTION public.list_staff_employees(text,text,integer,integer) SET SCHEMA app_private;
CREATE FUNCTION public.list_staff_employees(p_search text DEFAULT '',p_status text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT app_private.list_staff_employees(p_search,p_status,p_page,p_page_size);
$$;
REVOKE ALL ON FUNCTION public.get_staff_employee_access(uuid,uuid),public.list_staff_employees(text,text,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_employee_access(uuid,uuid),public.list_staff_employees(text,text,integer,integer) TO authenticated;
