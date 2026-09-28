-- Fix: the admin announcement composer writes through the service client
-- (createVendorAnnouncement -> a plain .insert(), by design — see
-- 20260928180000's comment: "no RLS INSERT policy, the staff-gated API
-- route is the only write path"), but that migration only granted
-- service_role SELECT on vendor_announcements, never INSERT. Every send
-- fails with "permission denied for table vendor_announcements". Same class
-- of miss as 20260928200000 (which fixed the sibling reads table).
GRANT INSERT ON TABLE public.vendor_announcements TO service_role;
