-- The user approved illustrative taxonomy values for the existing FYP demo
-- catalogue. Keep this deterministic and fill only empty metadata; vendors can
-- later replace these examples with their own confirmed choices.
WITH outlet_targets AS (
  SELECT
    outlet.id,
    (((ROW_NUMBER() OVER (ORDER BY COALESCE(outlet.slug, ''), outlet.id) - 1) % 7) + 1)::integer AS badge_pattern
  FROM public.outlets AS outlet
  WHERE COALESCE(CARDINALITY(outlet.badge_slugs), 0) = 0
),
updated_outlets AS (
  UPDATE public.outlets AS outlet
  SET badge_slugs = ARRAY_REMOVE(
    ARRAY[
      CASE WHEN target.badge_pattern IN (1, 3, 5, 7) THEN 'hidden_gem'::text END,
      CASE WHEN target.badge_pattern IN (2, 3, 6, 7) THEN 'family_friendly'::text END,
      CASE WHEN target.badge_pattern IN (4, 5, 6, 7) THEN 'couple_friendly'::text END
    ],
    NULL::text
  )
  FROM outlet_targets AS target
  WHERE outlet.id = target.id
    AND COALESCE(CARDINALITY(outlet.badge_slugs), 0) = 0
  RETURNING outlet.id
),
product_targets AS (
  SELECT
    product.id,
    CASE category.slug
      WHEN 'food' THEN ARRAY[
        'chinese', 'malay', 'nyonya', 'indian', 'mamak', 'western',
        'seafood', 'cafe-dessert', 'fusion'
      ]::text[]
      WHEN 'activity' THEN ARRAY[
        'nature', 'adventure', 'cultural', 'nightlife', 'wellness', 'water', 'sightseeing'
      ]::text[]
      WHEN 'retail' THEN ARRAY[
        'handicrafts', 'souvenirs', 'batik-textiles', 'fashion',
        'jewellery', 'local-produce', 'art-prints', 'duty-free'
      ]::text[]
    END AS type_options,
    ROW_NUMBER() OVER (
      PARTITION BY category.slug
      ORDER BY COALESCE(product.slug, ''), product.id
    ) AS category_ordinal
  FROM public.products AS product
  JOIN public.categories AS category ON category.id = product.category_id
  WHERE category.slug IN ('food', 'activity', 'retail')
    AND COALESCE(CARDINALITY(product.type_slugs), 0) = 0
),
updated_products AS (
  UPDATE public.products AS product
  SET type_slugs = ARRAY[
    target.type_options[
      (((target.category_ordinal - 1) % CARDINALITY(target.type_options)) + 1)::integer
    ]
  ]
  FROM product_targets AS target
  WHERE product.id = target.id
    AND COALESCE(CARDINALITY(product.type_slugs), 0) = 0
  RETURNING product.id
)
SELECT
  (SELECT COUNT(*) FROM updated_outlets) AS outlet_badges_filled,
  (SELECT COUNT(*) FROM updated_products) AS product_types_filled;
