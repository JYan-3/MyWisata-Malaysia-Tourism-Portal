ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS badge_slugs text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS accommodation_type_slugs text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.outlets.badge_slugs IS
  'Vendor-selected, server-validated discovery badge slugs for this outlet.';

COMMENT ON COLUMN public.outlets.accommodation_type_slugs IS
  'Vendor-selected, server-validated property type slugs for accommodation outlets.';

-- The preceding security migration revoked table-wide reads and re-granted
-- only an explicit public column allowlist. Grant only these public metadata
-- fields; existing row-level policies still decide which outlets are visible.
GRANT SELECT (badge_slugs, accommodation_type_slugs)
  ON TABLE public.outlets TO anon, authenticated;
