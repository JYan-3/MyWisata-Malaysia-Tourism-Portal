-- Require the updated thread to remain accessible to the same customer,
-- vendor owner, outlet manager, or administrator who could update it before.
ALTER POLICY chat_threads_participant_update ON public.chat_threads
  WITH CHECK (
    customer_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.outlets AS o
      JOIN public.vendors AS v ON v.id = o.vendor_id
      WHERE o.id = chat_threads.outlet_id
        AND v.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.outlet_managers AS om
      WHERE om.outlet_id = chat_threads.outlet_id
        AND om.user_id = (SELECT auth.uid())
    )
    OR app_private.is_admin((SELECT auth.uid()))
  );
