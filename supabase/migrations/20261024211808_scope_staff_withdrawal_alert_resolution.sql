-- Keep customer receipts separate from staff task resolution, even when their
-- withdrawal metadata matches. No historical notification rows are rewritten.
DO $migration$
DECLARE definition text; target text := 'WHERE type IN (''withdrawal_approval_task'', ''withdrawal_submitted'')';
BEGIN
  SELECT pg_get_functiondef('app_private.resolve_withdrawal_approver_notifications()'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,target,'')))/length(target)<>2 THEN RAISE EXCEPTION 'withdrawal_alert_source_changed'; END IF;
  definition:=replace(definition,target,target||E'\n       AND link LIKE ''/admin/withdrawals%''\n       AND user_id IS DISTINCT FROM NEW.user_id');
  EXECUTE definition;
END;
$migration$;
