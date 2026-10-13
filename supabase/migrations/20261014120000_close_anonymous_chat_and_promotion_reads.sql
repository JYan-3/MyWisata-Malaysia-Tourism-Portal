-- Close two anonymous-read gaps found by tests/e2e/security.spec.ts.
--
-- 1. chatbot_sessions / chatbot_messages: the SELECT policies allowed
--    `user_id IS NULL`, so anyone with the public anon key could list every guest
--    help-bot conversation. Every chatbot route reads these tables with the
--    service client; the one user-client read (POST /api/support/tickets) now uses
--    the service client too. Owners and admins keep read access.
-- 2. vendor_event_promotions: `status = 'paid'` made every paid row, including
--    amount_sen / payment_method / stripe_checkout_session_id, readable by anon
--    and by other vendors. The public event rail and detail page read the
--    listing columns through the service client (lib/customer/event-promotions.ts),
--    so the base table is now limited to admins and the owning vendor's team.
--
-- app_private.is_admin is the same function the old policies pointed at
-- (public.is_admin was moved there by 20261004054818); anon may execute it.

DROP POLICY IF EXISTS chatbot_sessions_own ON public.chatbot_sessions;
CREATE POLICY chatbot_sessions_own ON public.chatbot_sessions
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR app_private.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS chatbot_messages_own ON public.chatbot_messages;
CREATE POLICY chatbot_messages_own ON public.chatbot_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chatbot_sessions s
      WHERE s.id = chatbot_messages.session_id
        AND (
          s.user_id = (SELECT auth.uid())
          OR app_private.is_admin((SELECT auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS vendor_event_promotions_read ON public.vendor_event_promotions;
CREATE POLICY vendor_event_promotions_read ON public.vendor_event_promotions
  FOR SELECT USING (
    app_private.is_admin((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = vendor_id AND v.owner_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.outlet_managers om
      JOIN public.outlets o ON o.id = om.outlet_id
      WHERE om.user_id = (SELECT auth.uid()) AND o.vendor_id = vendor_event_promotions.vendor_id
    )
  );
