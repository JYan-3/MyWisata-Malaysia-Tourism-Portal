-- Keep personal copies of a shared Wallet Approver task aligned with the
-- authoritative withdrawal state. The status transition and alert update are
-- part of the same transaction.
CREATE INDEX IF NOT EXISTS notifications_wallet_withdrawal_task_lookup
  ON public.notifications ((metadata ->> 'withdrawal_id'), (metadata ->> 'approval_cycle'))
  WHERE category = 'wallet' AND type IN ('withdrawal_approval_task', 'withdrawal_submitted');

CREATE FUNCTION app_private.resolve_withdrawal_approver_notifications() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  notification_type text;
  resolution_label text;
  actor_id uuid;
  actor_name text;
  actor_action text;
  actioned_at timestamptz;
  resolved_at timestamptz;
  resolved_cycle integer;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.approval_cycle IS NOT DISTINCT FROM OLD.approval_cycle THEN
    RETURN NEW;
  END IF;

  IF NEW.approval_cycle IS DISTINCT FROM OLD.approval_cycle THEN
    resolved_cycle := coalesce(OLD.approval_cycle, 1);
    SELECT a.approver_id, a.action, a.actioned_at, u.full_name
      INTO actor_id, actor_action, actioned_at, actor_name
      FROM public.withdrawal_approvals AS a
      LEFT JOIN public.users AS u ON u.id = a.approver_id
     WHERE a.request_id = NEW.id
       AND coalesce(a.approval_cycle, 1) = resolved_cycle
     ORDER BY a.actioned_at DESC, a.id DESC
     LIMIT 1;

    actor_id := coalesce(actor_id, auth.uid());
    IF actor_name IS NULL AND actor_id IS NOT NULL THEN
      SELECT users.full_name INTO actor_name FROM public.users WHERE users.id = actor_id;
    END IF;
    actor_name := coalesce(nullif(btrim(actor_name), ''), 'System');
    resolved_at := coalesce(actioned_at, clock_timestamp());

    UPDATE public.notifications
       SET type = 'withdrawal_approval_cycle_restarted',
           title = 'Withdrawal review cycle restarted',
           body = 'This review cycle was replaced by a newer cycle.',
           read_at = coalesce(read_at, resolved_at),
           metadata = metadata || jsonb_build_object(
             'resolved_by', actor_id,
             'resolved_by_name', actor_name,
             'resolved_action', coalesce(actor_action, 'resume'),
             'resolved_at', resolved_at,
             'resolution_status', NEW.status
           )
     WHERE type IN ('withdrawal_approval_task', 'withdrawal_submitted')
       AND category = 'wallet'
       AND metadata ->> 'withdrawal_id' = NEW.id::text
       AND metadata ->> 'approval_cycle' = resolved_cycle::text;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status = 'pending_second_approval' THEN
      notification_type := 'withdrawal_approval_step_completed';
    ELSIF NEW.status NOT IN ('pending', 'pending_second_approval', 'hold', 'overdue') THEN
      notification_type := 'withdrawal_approval_resolved';
    ELSE
      RETURN NEW;
    END IF;

    SELECT a.approver_id, a.action, a.actioned_at, u.full_name
      INTO actor_id, actor_action, actioned_at, actor_name
      FROM public.withdrawal_approvals AS a
      LEFT JOIN public.users AS u ON u.id = a.approver_id
     WHERE a.request_id = NEW.id
       AND coalesce(a.approval_cycle, 1) = coalesce(NEW.approval_cycle, 1)
     ORDER BY a.actioned_at DESC, a.id DESC
     LIMIT 1;

    actor_id := coalesce(actor_id, auth.uid());
    IF actor_name IS NULL AND actor_id IS NOT NULL THEN
      SELECT users.full_name INTO actor_name FROM public.users WHERE users.id = actor_id;
    END IF;
    actor_name := coalesce(nullif(btrim(actor_name), ''), 'System');
    resolved_at := coalesce(actioned_at, clock_timestamp());
    resolution_label := CASE WHEN notification_type = 'withdrawal_approval_step_completed'
      THEN 'step_completed' ELSE 'completed' END;

    UPDATE public.notifications
       SET type = notification_type,
           title = CASE WHEN notification_type = 'withdrawal_approval_step_completed'
             THEN 'First withdrawal review completed' ELSE 'Withdrawal review completed' END,
           body = CASE WHEN notification_type = 'withdrawal_approval_step_completed'
             THEN 'The first approval is complete. A second approver must review this withdrawal.'
             ELSE 'This withdrawal review is complete.' END,
           read_at = coalesce(read_at, resolved_at),
           metadata = metadata || jsonb_build_object(
             'resolved_by', actor_id,
             'resolved_by_name', actor_name,
             'resolved_action', coalesce(actor_action, 'review'),
             'resolved_at', resolved_at,
             'resolution_status', NEW.status,
             'resolution', resolution_label
           )
     WHERE type IN ('withdrawal_approval_task', 'withdrawal_submitted')
       AND category = 'wallet'
       AND metadata ->> 'withdrawal_id' = NEW.id::text
       AND metadata ->> 'approval_cycle' = coalesce(NEW.approval_cycle, 1)::text
       AND (
         notification_type <> 'withdrawal_approval_step_completed'
         OR coalesce(event_key, '') NOT LIKE '%:stage:second'
       );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.resolve_withdrawal_approver_notifications() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS resolve_withdrawal_approver_notifications ON public.withdrawal_requests;
CREATE TRIGGER resolve_withdrawal_approver_notifications
  AFTER UPDATE OF status, approval_cycle ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION app_private.resolve_withdrawal_approver_notifications();

-- The notification worker must serialize its write with withdrawal status
-- changes. If it wins the row lock, the status trigger resolves its row next;
-- if the status transition wins, this RPC skips the stale task.
CREATE FUNCTION app_private.deliver_withdrawal_approver_notifications(
  p_id uuid,
  p_cycle integer,
  p_stage text,
  p_token uuid,
  p_cursor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  job app_private.withdrawal_approver_jobs%ROWTYPE;
  withdrawal public.withdrawal_requests%ROWTYPE;
  recipients jsonb;
  stage_suffix text;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  SELECT * INTO withdrawal
    FROM public.withdrawal_requests
   WHERE id = p_id
   FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE app_private.withdrawal_approver_jobs
       SET completed = true, token = NULL, lease_until = NULL
     WHERE withdrawal_id = p_id AND cycle = p_cycle AND stage = p_stage
       AND token = p_token AND cursor_id IS NOT DISTINCT FROM p_cursor;
    RETURN jsonb_build_object('stale', true, 'recipients', '[]'::jsonb);
  END IF;

  SELECT * INTO job
    FROM app_private.withdrawal_approver_jobs
   WHERE withdrawal_id = p_id AND cycle = p_cycle AND stage = p_stage
     AND token = p_token AND cursor_id IS NOT DISTINCT FROM p_cursor
     AND lease_until > now() AND NOT completed
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('stale', true, 'recipients', '[]'::jsonb); END IF;

  IF withdrawal.status IS DISTINCT FROM p_stage
     OR coalesce(withdrawal.approval_cycle, 1) IS DISTINCT FROM p_cycle THEN
    UPDATE app_private.withdrawal_approver_jobs
       SET completed = true, token = NULL, lease_until = NULL
     WHERE withdrawal_id = p_id AND cycle = p_cycle AND stage = p_stage AND token = p_token;
    RETURN jsonb_build_object('stale', true, 'recipients', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(batch)), '[]'::jsonb)
    INTO recipients
    FROM (
      SELECT users.id, users.email, users.full_name, users.preferred_locale
        FROM public.users
       WHERE users.id <> withdrawal.user_id
         AND (p_cursor IS NULL OR users.id > p_cursor)
         AND users.status = 'active'
         AND EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_roles.user_id = users.id
              AND user_roles.vendor_id IS NULL
              AND user_roles.outlet_id IS NULL
         )
         AND public.has_staff_permission(users.id, 'admin.withdrawal.approve')
       ORDER BY users.id
       LIMIT 25
    ) AS batch;

  stage_suffix := CASE WHEN p_stage = 'pending_second_approval' THEN ':stage:second' ELSE '' END;
  INSERT INTO public.notifications(user_id, type, title, body, link, category, event_key, metadata)
  SELECT recipient.id,
         'withdrawal_approval_task',
         'Withdrawal awaiting review',
         'A withdrawal review task is waiting. Open the protected Admin page to review it.',
         '/admin/withdrawals/' || p_id::text,
         'wallet',
         'withdrawal_submitted:' || p_id::text || ':cycle:' || p_cycle::text || ':approver:' || recipient.id::text || stage_suffix,
         jsonb_build_object('withdrawal_id', p_id, 'approval_cycle', p_cycle)
    FROM jsonb_to_recordset(recipients) AS recipient(id uuid)
  ON CONFLICT (event_key) DO NOTHING;

  RETURN jsonb_build_object('stale', false, 'recipients', recipients);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.finish_withdrawal_approver_job(
  p_id uuid,
  p_cycle integer,
  p_stage text,
  p_token uuid,
  p_cursor uuid,
  p_complete boolean,
  p_failed boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  job app_private.withdrawal_approver_jobs%ROWTYPE;
  withdrawal public.withdrawal_requests%ROWTYPE;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  SELECT * INTO withdrawal FROM public.withdrawal_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE app_private.withdrawal_approver_jobs
       SET completed = true, token = NULL, lease_until = NULL
     WHERE withdrawal_id = p_id AND cycle = p_cycle AND stage = p_stage AND token = p_token;
    RETURN FOUND;
  END IF;

  SELECT * INTO job
    FROM app_private.withdrawal_approver_jobs
   WHERE withdrawal_id = p_id AND cycle = p_cycle AND stage = p_stage
     AND token = p_token AND lease_until > now()
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF withdrawal.status IS DISTINCT FROM p_stage
     OR coalesce(withdrawal.approval_cycle, 1) IS DISTINCT FROM p_cycle THEN
    UPDATE app_private.withdrawal_approver_jobs
       SET completed = true, token = NULL, lease_until = NULL
     WHERE withdrawal_id = p_id AND cycle = p_cycle AND stage = p_stage AND token = p_token;
    RETURN FOUND;
  END IF;

  UPDATE app_private.withdrawal_approver_jobs
     SET cursor_id = CASE WHEN p_failed THEN cursor_id ELSE p_cursor END,
         completed = CASE WHEN p_failed THEN false ELSE p_complete END,
         token = NULL,
         lease_until = NULL,
         attempts = CASE WHEN p_failed THEN attempts ELSE 0 END,
         available_at = now() + CASE WHEN p_failed THEN interval '1 minute' ELSE interval '0 seconds' END
   WHERE withdrawal_id = p_id AND cycle = p_cycle AND stage = p_stage AND token = p_token;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.deliver_withdrawal_approver_notifications(
  p_id uuid, p_cycle integer, p_stage text, p_token uuid, p_cursor uuid
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_private.deliver_withdrawal_approver_notifications(p_id, p_cycle, p_stage, p_token, p_cursor);
$$;

REVOKE ALL ON FUNCTION app_private.deliver_withdrawal_approver_notifications(uuid, integer, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deliver_withdrawal_approver_notifications(uuid, integer, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.deliver_withdrawal_approver_notifications(uuid, integer, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.deliver_withdrawal_approver_notifications(uuid, integer, text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.finish_withdrawal_approver_job(uuid, integer, text, uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.finish_withdrawal_approver_job(uuid, integer, text, uuid, uuid, boolean, boolean) TO service_role;

-- Reconcile only staff-facing legacy task rows. Customer status notices are
-- excluded by their customer-wallet link and by the owner check.
UPDATE public.notifications AS n
   SET type = CASE
         WHEN coalesce(n.metadata ->> 'approval_cycle', '1')::integer < coalesce(w.approval_cycle, 1)
           THEN 'withdrawal_approval_cycle_restarted'
         WHEN w.status = 'pending_second_approval' AND coalesce(n.event_key, '') NOT LIKE '%:stage:second'
           THEN 'withdrawal_approval_step_completed'
         ELSE 'withdrawal_approval_resolved'
       END,
       title = 'Withdrawal review status updated',
       body = 'This withdrawal review task has changed.',
       read_at = coalesce(n.read_at, now()),
       metadata = n.metadata || jsonb_build_object(
         'resolved_by', (
           SELECT a.approver_id FROM public.withdrawal_approvals AS a
            WHERE a.request_id = w.id
              AND coalesce(a.approval_cycle, 1) = coalesce(n.metadata ->> 'approval_cycle', '1')::integer
            ORDER BY a.actioned_at DESC, a.id DESC LIMIT 1
         ),
         'resolved_by_name', coalesce((
           SELECT nullif(btrim(u.full_name), '')
             FROM public.withdrawal_approvals AS a
             JOIN public.users AS u ON u.id = a.approver_id
            WHERE a.request_id = w.id
              AND coalesce(a.approval_cycle, 1) = coalesce(n.metadata ->> 'approval_cycle', '1')::integer
            ORDER BY a.actioned_at DESC, a.id DESC LIMIT 1
         ), 'System'),
         'resolved_action', coalesce((
           SELECT a.action FROM public.withdrawal_approvals AS a
            WHERE a.request_id = w.id
              AND coalesce(a.approval_cycle, 1) = coalesce(n.metadata ->> 'approval_cycle', '1')::integer
            ORDER BY a.actioned_at DESC, a.id DESC LIMIT 1
         ), 'system'),
         'resolved_at', coalesce((
           SELECT a.actioned_at FROM public.withdrawal_approvals AS a
            WHERE a.request_id = w.id
              AND coalesce(a.approval_cycle, 1) = coalesce(n.metadata ->> 'approval_cycle', '1')::integer
            ORDER BY a.actioned_at DESC, a.id DESC LIMIT 1
         ), now()),
         'resolution_status', w.status
       )
  FROM public.withdrawal_requests AS w
 WHERE n.category = 'wallet'
   AND n.type IN ('withdrawal_approval_task', 'withdrawal_submitted')
   AND n.link LIKE '/admin/withdrawals/%'
   AND n.user_id IS DISTINCT FROM w.user_id
   AND n.metadata ->> 'withdrawal_id' = w.id::text
   AND (
     coalesce(n.metadata ->> 'approval_cycle', '1')::integer < coalesce(w.approval_cycle, 1)
     OR w.status NOT IN ('pending', 'pending_second_approval', 'hold', 'overdue')
     OR (w.status = 'pending_second_approval' AND coalesce(n.event_key, '') NOT LIKE '%:stage:second')
   );

UPDATE public.notifications AS n
   SET type = 'withdrawal_approval_unavailable',
       title = 'Withdrawal review task unavailable',
       body = 'The withdrawal review record is no longer available.',
       read_at = coalesce(n.read_at, now()),
       metadata = n.metadata || jsonb_build_object(
         'resolved_by_name', 'System',
         'resolved_action', 'record_unavailable',
         'resolved_at', now(),
         'resolution_status', 'missing'
       )
 WHERE n.category = 'wallet'
   AND n.type IN ('withdrawal_approval_task', 'withdrawal_submitted')
   AND n.link LIKE '/admin/withdrawals/%'
   AND NOT EXISTS (
     SELECT 1 FROM public.withdrawal_requests AS w
      WHERE n.metadata ->> 'withdrawal_id' = w.id::text
   );

NOTIFY pgrst, 'reload schema';
