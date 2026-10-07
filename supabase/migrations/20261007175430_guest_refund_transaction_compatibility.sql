-- Extend the installed atomic refund request without changing its account API.
-- The server first authorizes the exact Guest order; this service-only boundary
-- additionally binds the supplied subject to that locked Guest-owned order.
DO $migration$
DECLARE source text;
BEGIN
  SELECT p.prosrc INTO source FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure('public.request_order_refund(uuid,uuid,text)')
      AND l.lanname='plpgsql' AND p.prosecdef;
  IF source IS NULL
     OR position('service_role_required' IN source)=0
     OR position('IF p_user_id IS NULL OR' IN source)=0
     OR position('IF NOT FOUND OR v_order.user_id <> p_user_id THEN' IN source)=0
     OR position('SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;' IN source)=0
     OR position('refund_payment_ambiguous' IN source)=0
     OR position('refund_already_active' IN source)=0
     OR position('PERFORM public.snapshot_order_refund_funding(v_refund.id);' IN source)=0 THEN
    RAISE EXCEPTION 'guest_refund_source_preflight_required';
  END IF;
  source:=replace(source,'IF NOT FOUND OR v_order.user_id <> p_user_id THEN',
    'IF NOT FOUND OR v_order.user_id IS NOT NULL OR v_order.guest_subject_id IS DISTINCT FROM p_guest_subject_id THEN');
  source:=replace(source,'p_user_id','p_guest_subject_id');
  EXECUTE format('CREATE FUNCTION public.guest_request_order_refund(p_order_id uuid,p_guest_subject_id uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = %L AS %L','',source);
END; $migration$;
REVOKE ALL ON FUNCTION public.guest_request_order_refund(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_request_order_refund(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
