-- Safe to run against the linked project: all controls roll back.

BEGIN;

SET LOCAL ROLE anon;

SET LOCAL request.jwt.claims = '{"role":"anon"}';

DO $$ BEGIN
  PERFORM public.credit_earnings(NULL,1,NULL,NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.credit_pending_earnings(NULL,1,NULL,NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.reserve_for_withdrawal(NULL,1,NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.reverse_pending_earnings(NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.get_withdrawal_notification_snapshot(NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.submit_withdrawal(NULL,1,NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

RESET ROLE;

SET LOCAL ROLE authenticated;

SET LOCAL request.jwt.claims = '{"role":"authenticated"}';

DO $$ BEGIN
  PERFORM public.credit_earnings(NULL,1,NULL,NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.credit_pending_earnings(NULL,1,NULL,NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.reserve_for_withdrawal(NULL,1,NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.reverse_pending_earnings(NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.get_withdrawal_notification_snapshot(NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

DO $$ BEGIN
  PERFORM public.submit_withdrawal(NULL,1,NULL);
  RAISE EXCEPTION 'security_denial_missing';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

RESET ROLE;

SET LOCAL ROLE service_role;

SET LOCAL request.jwt.claims = '{"role":"service_role"}';

DO $$
DECLARE v_user uuid; v_before bigint; v_after bigint;
BEGIN
  SELECT user_id, earnings_sen INTO v_user, v_before FROM public.wallets ORDER BY id LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'service_control_fixture_missing'; END IF;
  PERFORM public.credit_earnings(v_user, 1, NULL, 'rollback security control');
  SELECT earnings_sen INTO v_after FROM public.wallets WHERE user_id = v_user;
  IF v_after <> v_before + 1 THEN RAISE EXCEPTION 'service_credit_failed'; END IF;
END $$;

ROLLBACK;

SELECT 'wallet_security_denial_and_service_control_passed' AS result;
