CREATE OR REPLACE FUNCTION app_private.affiliate_maturity_exposure()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH aggregate AS (
    SELECT
      count(*) FILTER (WHERE aa.status = 'pending') AS pending_count,
      COALESCE(sum(aa.commission_amount) FILTER (WHERE aa.status = 'pending'), 0) AS pending_amount_rm,
      count(*) FILTER (WHERE aa.status = 'confirmed' AND lower(o.status) = 'paid') AS paid_order_count,
      COALESCE(sum(aa.commission_amount) FILTER (WHERE aa.status = 'confirmed' AND lower(o.status) = 'paid'), 0) AS paid_order_amount_rm,
      count(*) FILTER (WHERE aa.status = 'confirmed' AND lower(o.status) = 'refunded') AS refunded_count,
      COALESCE(sum(aa.commission_amount) FILTER (WHERE aa.status = 'confirmed' AND lower(o.status) = 'refunded'), 0) AS refunded_amount_rm,
      count(*) FILTER (WHERE aa.status = 'confirmed' AND lower(o.status) NOT IN ('paid','completed','refunded')) AS other_status_count,
      COALESCE(sum(aa.commission_amount) FILTER (WHERE aa.status = 'confirmed' AND lower(o.status) NOT IN ('paid','completed','refunded')), 0) AS other_status_amount_rm
    FROM public.affiliate_attributions aa
    JOIN public.orders o ON o.id = aa.order_id
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'pending', jsonb_build_object('count', pending_count, 'amount_rm', pending_amount_rm),
    'confirmed_on_paid_orders', jsonb_build_object('count', paid_order_count, 'amount_rm', paid_order_amount_rm),
    'confirmed_on_refunded_orders', jsonb_build_object('count', refunded_count, 'amount_rm', refunded_amount_rm),
    'confirmed_on_other_statuses', jsonb_build_object('count', other_status_count, 'amount_rm', other_status_amount_rm)
  ) FROM aggregate;
$$;
REVOKE ALL ON FUNCTION app_private.affiliate_maturity_exposure() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.affiliate_maturity_exposure()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.affiliate_maturity_exposure();
$$;
REVOKE ALL ON FUNCTION public.affiliate_maturity_exposure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_maturity_exposure() TO service_role;
