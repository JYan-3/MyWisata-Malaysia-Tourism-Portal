-- Logged-out visitors and signed-in users could read every column of an
-- approved vendor through the REST API, including the admin's rejection
-- reason, the approval email, who approved it and the platform commission
-- rate. Row access (RLS) is unchanged; this narrows the readable columns to
-- what the app actually reads through user clients.
--
-- Withheld: rejection_reason, approved_by, approved_at, approval_email_sent_at,
-- approval_email_subject, approval_email_body, platform_commission_rate.
-- Staff screens read those through the service role after a permission
-- check; SECURITY DEFINER functions are unaffected. Columns added later are
-- not readable until granted here.
-- owner_id stays readable: RLS policies and ownership checks compare it
-- with auth.uid() under the caller's own privileges.

REVOKE SELECT ON public.vendors FROM anon, authenticated;

GRANT SELECT (
  id, owner_id, name, slug, description, logo_url, cover_url,
  business_type, status, kind, created_at, updated_at
) ON public.vendors TO anon, authenticated;

-- Storefront featured products are public too. The column comes from
-- 20260912190000_vendor_featured_products.sql, which grants it as well in
-- case it is applied after this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'vendors' AND column_name = 'featured_product_ids'
  ) THEN
    GRANT SELECT (featured_product_ids) ON public.vendors TO anon, authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
