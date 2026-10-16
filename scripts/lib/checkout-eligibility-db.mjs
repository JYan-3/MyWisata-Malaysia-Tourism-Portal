// Bounded extension of the existing disposable loopback event DB runner.
import fs from 'node:fs';
import pg from 'pg';

export async function verifyCheckoutEligibility({ db, query, config }) {
  const sql = (file) => fs.readFileSync(file, 'utf8');
  await query(db, sql('supabase/tests/checkout_subject_core_baseline.sql'));
  await query(db, sql('supabase/migrations/20261016111059_checkout_subject_commitment_guards.sql'));
  await query(db, sql('supabase/tests/checkout_subject_eligibility.sql'));
  console.log('passed checkout owner budget, retry, expiry, receipt and eligibility transactions');
  await query(db, "SET request.jwt.claim.role='service_role'; SET request.jwt.claim.sub=''; SET request.jwt.claims='{\"role\":\"service_role\"}'; SELECT public.finalize_checkout(id,'expired') FROM public.checkout_sessions WHERE status IN ('pending_payment','requires_action')");

  // Two real PostgreSQL sessions: different keys compete on the same subject;
  // a different subject can acquire its owner lock without waiting.
  const a = new pg.Client(config); const b = new pg.Client(config); const other = new pg.Client(config);
  await Promise.all([a.connect(), b.connect(), other.connect()]);
  try {
    await query(a, 'BEGIN'); await query(b, 'BEGIN'); await query(other, 'BEGIN');
    await query(a, "SELECT app_private.lock_checkout_owner('00000000-0000-0000-0000-000000000004',NULL)");
    await query(other, "SET LOCAL lock_timeout='500ms'; SELECT app_private.lock_checkout_owner('00000000-0000-0000-0000-000000000005',NULL)");
    await query(b, "SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL statement_timeout='5s'");
    let finished = false;
    const second = query(b, "SELECT public.prepare_event_checkout('77777777-7777-4777-8777-777777777777','2026-10-10','88888888-8888-4888-8888-888888888888',1,'stripe_card','concurrent-key-b','concurrent-b')")
      .then(() => { finished = true; return null; }, error => { finished = true; return error; });
    // Observe PostgreSQL's advisory wait instead of assuming timing proves it.
    for (let n = 0; n < 30; n++) {
      const waiting = await query(other, "SELECT count(*)::integer n FROM pg_stat_activity WHERE pid=$1 AND wait_event='advisory'", [b.processID]);
      if (waiting.rows[0].n === 1) break;
      if (finished || n === 29) throw new Error('same-subject checkout did not wait on its owner lock');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await query(a, "SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET LOCAL request.jwt.claim.role='authenticated'; SELECT public.prepare_event_checkout('77777777-7777-4777-8777-777777777777','2026-10-10','88888888-8888-4888-8888-888888888888',1,'stripe_card','concurrent-key-a','concurrent-a')");
    await query(a, 'COMMIT');
    const error = await second;
    if (error?.message !== 'active_checkout_exists') throw new Error(`second checkout did not reject duplicate hold: ${error?.message}`);
    console.log('passed two-session same-owner budget and independent-owner lock');
  } finally {
    await Promise.allSettled([query(a, 'ROLLBACK'), query(b, 'ROLLBACK'), query(other, 'ROLLBACK')]);
    await Promise.all([a.end(), b.end(), other.end()]);
  }
  await query(db, sql('supabase/tests/withdrawal_execution_fixture.sql'));
  const eligibility = sql('supabase/migrations/20260830013000_independent_capability_hard_guards.sql')
    .match(/CREATE OR REPLACE FUNCTION public\.enforce_withdrawal_eligibility\(\)[\s\S]*?^\$\$;/m)?.[0];
  if (!eligibility) throw new Error('withdrawal destination trigger source missing');
  await query(db, eligibility + '\nCREATE TRIGGER withdrawal_require_verified_destination BEFORE INSERT ON public.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION public.enforce_withdrawal_eligibility();');
  await query(db, sql('supabase/migrations/20261016111120_withdrawal_execution_eligibility.sql'));
  await query(db, sql('supabase/tests/withdrawal_execution_eligibility.sql'));
  console.log('passed payout eligibility holds, identity generation, reserve retention and claim permissions');
}
