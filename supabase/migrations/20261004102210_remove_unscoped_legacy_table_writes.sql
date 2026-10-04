-- The current application does not use these legacy tables through the Data
-- API. Preserve read policies, but remove universal anon/authenticated writes.
DROP POLICY IF EXISTS "Shared app can update alerts" ON public.alerts;
DROP POLICY IF EXISTS "Shared app can write alerts" ON public.alerts;
DROP POLICY IF EXISTS "Shared app can write readings" ON public.readings;
DROP POLICY IF EXISTS "Shared app can write reports" ON public.reports;
