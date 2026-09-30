-- Allow vendor owners to select up to 4 featured products for their storefront
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS featured_product_ids uuid[] DEFAULT '{}'::uuid[];

-- Vendor columns are granted individually (20260930240000_restrict_vendor_columns.sql).
GRANT SELECT (featured_product_ids) ON public.vendors TO anon, authenticated;
