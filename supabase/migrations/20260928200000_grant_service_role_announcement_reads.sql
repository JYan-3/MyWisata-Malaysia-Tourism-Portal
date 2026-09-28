-- Fix: the vendor announcements API reads vendor_announcement_reads through the
-- service client, but 20260928180000 granted SELECT on that table to
-- `authenticated` only (vendor_announcements was granted to service_role too).
-- Without this grant the read throws "permission denied for table
-- vendor_announcement_reads", the route 500s with an empty body, and the vendor
-- inbox shows "Unexpected end of JSON input". Align the grant with
-- vendor_announcements.
GRANT SELECT ON TABLE public.vendor_announcement_reads TO service_role;
