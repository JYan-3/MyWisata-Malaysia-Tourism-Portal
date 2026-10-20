BEGIN;

CREATE VIEW public.review_rating_metrics_by_scope
WITH (security_invoker = true) AS
SELECT
  'vendor'::text AS scope_type,
  vendor_id AS scope_id,
  NULL::uuid AS context_scope_id,
  rating,
  COUNT(*)::bigint AS review_count
FROM public.reviews
WHERE is_visible = true
  AND vendor_id IS NOT NULL
GROUP BY vendor_id, rating

UNION ALL

SELECT
  'outlet'::text AS scope_type,
  outlet_id AS scope_id,
  NULL::uuid AS context_scope_id,
  rating,
  COUNT(*)::bigint AS review_count
FROM public.reviews
WHERE is_visible = true
  AND outlet_id IS NOT NULL
GROUP BY outlet_id, rating

UNION ALL

SELECT
  'product'::text AS scope_type,
  product_id AS scope_id,
  NULL::uuid AS context_scope_id,
  rating,
  COUNT(*)::bigint AS review_count
FROM public.reviews
WHERE is_visible = true
  AND product_id IS NOT NULL
GROUP BY product_id, rating

UNION ALL

SELECT
  'product_outlet'::text AS scope_type,
  product_id AS scope_id,
  outlet_id AS context_scope_id,
  rating,
  COUNT(*)::bigint AS review_count
FROM public.reviews
WHERE is_visible = true
  AND product_id IS NOT NULL
  AND outlet_id IS NOT NULL
GROUP BY product_id, outlet_id, rating

UNION ALL

SELECT
  'outlet_accommodation'::text AS scope_type,
  reviews.outlet_id AS scope_id,
  NULL::uuid AS context_scope_id,
  reviews.rating,
  COUNT(*)::bigint AS review_count
FROM public.reviews AS reviews
JOIN public.products AS products ON products.id = reviews.product_id
JOIN public.categories AS categories ON categories.id = products.category_id
WHERE reviews.is_visible = true
  AND reviews.outlet_id IS NOT NULL
  AND categories.slug = 'accommodation'
GROUP BY reviews.outlet_id, reviews.rating;

REVOKE ALL PRIVILEGES ON TABLE public.review_rating_metrics_by_scope FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.review_rating_metrics_by_scope TO service_role;

COMMIT;
