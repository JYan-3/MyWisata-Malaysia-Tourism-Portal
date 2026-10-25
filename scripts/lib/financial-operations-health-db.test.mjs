import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sampleSize = 100_000;
const money = value => Number(value ?? 0);

/** Runs only inside the disposable PostgreSQL cluster owned by commerce-risk-db.test.mjs. */
export async function verifyFinancialOperationsHealth({ query }) {
  const sql = (text, values = []) => query(text, values);
  await sql(`
    ALTER TABLE public.wallets
      ADD COLUMN IF NOT EXISTS earnings_sen bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS pending_earnings_sen bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reserved_earnings_sen bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS withdrawn_earnings_sen bigint NOT NULL DEFAULT 0;
    ALTER TABLE public.affiliate_attributions
      ADD COLUMN IF NOT EXISTS cleared_at timestamptz,
      ADD COLUMN IF NOT EXISTS hold_until timestamptz;
    ALTER TABLE public.recommendation_commissions
      ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS order_id uuid,
      ADD COLUMN IF NOT EXISTS commission_rate numeric(5,4),
      ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
      ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
    ALTER TABLE public.withdrawal_requests
      ADD COLUMN IF NOT EXISTS payout_fee numeric(12,2) NOT NULL DEFAULT 0,
      DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;
    ALTER TABLE public.withdrawal_requests ADD CONSTRAINT withdrawal_requests_status_check
      CHECK(status IN ('pending','pending_second_approval','approved','processing','hold','overdue','paid','completed','rejected','failed'));
    CREATE TABLE IF NOT EXISTS public.affiliate_guest_commission_reviews(
      attribution_id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS public.affiliate_guest_commission_review_events(
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await sql(await fs.readFile(path.join(repo, 'supabase/migrations/20261025090830_financial_operations_health.sql'), 'utf8'));
  await sql(await fs.readFile(path.join(repo, 'supabase/migrations/20261025102035_financial_operations_lifetime_totals.sql'), 'utf8'));
  await sql(`INSERT INTO app_private.financial_health_snapshot(singleton,snapshot,computed_at)
    VALUES(true,'{"availability":"partial","liabilitiesSen":{"pendingRewards":12}}'::jsonb,now())
    ON CONFLICT(singleton) DO UPDATE SET snapshot=EXCLUDED.snapshot,computed_at=EXCLUDED.computed_at`);
  await sql(await fs.readFile(path.join(repo, 'supabase/migrations/20261025102757_financial_operations_aggregate_scan_optimization.sql'), 'utf8'));
  assert.ok(Number((await sql(`SELECT extract(epoch FROM now()-computed_at) AS age FROM app_private.financial_health_snapshot WHERE singleton`)).rows[0].age) > 60,
    'deployment must invalidate cached JSON produced by the prior key contract');

  const setServiceRole = async () => {
    await sql(`SELECT set_config('request.jwt.claim.role','service_role',false),
      set_config('request.jwt.claims','{"role":"service_role"}',false)`);
    await sql('SET ROLE service_role');
  };
  const asDatabaseOwner = async () => sql('RESET ROLE');
  const health = async () => {
    await setServiceRole();
    try { return (await sql('SELECT public.financial_operations_health() AS result')).rows[0].result; }
    finally { await asDatabaseOwner(); }
  };
  const sourceTotals = async () => (await sql(`SELECT
    coalesce((SELECT sum(pending_earnings_sen) FROM public.wallets),0)::numeric AS wallet_pending_sen,
    coalesce((SELECT sum(earnings_sen) FROM public.wallets),0)::numeric AS available_sen,
    coalesce((SELECT sum(reserved_earnings_sen) FROM public.wallets),0)::numeric AS reserved_sen,
    coalesce((SELECT sum(round(commission_amount*100)) FROM public.affiliate_attributions WHERE status='pending' AND hold_until IS NULL),0)::numeric AS affiliate_pending_sen,
    coalesce((SELECT sum(round(commission_amount*100)) FROM public.affiliate_attributions WHERE status='confirmed'),0)::numeric AS affiliate_confirmed_sen,
    coalesce((SELECT sum(round(a.commission_amount*100)) FROM public.affiliate_attributions a JOIN public.orders o ON o.id=a.order_id WHERE a.status='confirmed' AND lower(o.status)='refunded'),0)::numeric AS refunded_confirmed_sen,
    coalesce((SELECT sum(round(amount*100)) FROM public.recommendation_commissions WHERE status='confirmed'),0)::numeric AS recommendation_confirmed_sen,
    coalesce((SELECT sum(round(payout_fee*100)) FROM public.withdrawal_requests WHERE status IN ('paid','completed')),0)::numeric AS payout_fees_sen,
    coalesce((SELECT sum(shortfall_sen) FROM public.settlement_clawback_shortfalls),0)::numeric AS refund_shortfalls_sen`)).rows[0];

  await sql(`UPDATE app_private.financial_health_snapshot SET computed_at=now()-interval '61 seconds' WHERE singleton`);
  const baselineHealth = await health();
  const baselineTotals = await sourceTotals();
  assert.equal(baselineHealth.availability, 'partial');
  assert.ok(baselineHealth.liabilitiesSen, 'supported baseline liabilities should be populated');
  assert.ok(baselineHealth.economicsSen, 'supported baseline economics should be populated');
  assert.equal(baselineHealth.economicsSen.netMargin, null, 'incomplete revenue evidence must stay unknown');
  assert.equal(baselineHealth.cashAvailableSen, null, 'wallet balances are not a cash balance');

  await sql(`
    INSERT INTO public.users(id,email)
    SELECT md5('t11-owner-'||n)::uuid,'t11-owner-'||n||'@example.test'
    FROM generate_series(1,${sampleSize}) n;
    INSERT INTO public.wallets(id,user_id,earnings_sen,pending_earnings_sen,reserved_earnings_sen,withdrawn_earnings_sen)
    SELECT md5('t11-wallet-'||n)::uuid,md5('t11-owner-'||n)::uuid,n,n%7,n%3,0
    FROM generate_series(1,${sampleSize}) n;
    INSERT INTO public.affiliate_links(id,user_id,affiliate_code)
    SELECT md5('t11-link-'||n)::uuid,md5('t11-owner-'||n)::uuid,'t11-'||n
    FROM generate_series(1,${sampleSize}) n;
    INSERT INTO public.affiliate_clicks(id,link_id,created_at)
    SELECT md5('t11-click-'||n)::uuid,md5('t11-link-'||n)::uuid,now()-interval '8 days'
    FROM generate_series(1,${sampleSize}) n;
    INSERT INTO public.orders(id,user_id,status,subtotal,total_amount,created_at)
    SELECT md5('t11-order-'||n)::uuid,md5('t11-owner-'||n)::uuid,
      CASE WHEN n%100=1 THEN 'refunded' ELSE 'paid' END,100,100,now()-interval '8 days'
    FROM generate_series(1,${sampleSize}) n;
    INSERT INTO public.affiliate_attributions(id,click_id,order_id,commission_rate,commission_amount,status,created_at,cleared_at,hold_until)
    SELECT md5('t11-attribution-'||n)::uuid,md5('t11-click-'||n)::uuid,md5('t11-order-'||n)::uuid,0.03,(n%9+1)::numeric/10,
      CASE WHEN n%5=0 THEN 'pending' WHEN n%5=1 THEN 'confirmed' ELSE 'reversed' END,
      CASE WHEN n%5=0 THEN now()-interval '8 days' ELSE now()-interval '5 minutes' END,
      CASE WHEN n%5=1 THEN now()-interval '5 minutes' ELSE NULL END,
      CASE WHEN n%10=0 THEN now()+interval '1 day' ELSE NULL END
    FROM generate_series(1,${sampleSize}) n;
    UPDATE public.wallets wallet
    SET pending_earnings_sen = wallet.pending_earnings_sen + round(attribution.commission_amount*100)::bigint
    FROM public.affiliate_attributions attribution
    JOIN public.affiliate_clicks click ON click.id=attribution.click_id
    JOIN public.affiliate_links link ON link.id=click.link_id
    WHERE attribution.status='pending' AND attribution.hold_until IS NOT NULL
      AND link.affiliate_code LIKE 't11-%'
      AND wallet.user_id=link.user_id;
    INSERT INTO public.recommendation_commissions(id,recommender_id,commission_type,amount,status)
    SELECT md5('t11-rec-commission-'||n)::uuid,md5('t11-owner-'||n)::uuid,
      'ongoing',(n%11+1)::numeric,CASE WHEN n%3=1 THEN 'confirmed' WHEN n%3=0 THEN 'pending' ELSE 'reversed' END
    FROM generate_series(1,${sampleSize}) n;
    INSERT INTO public.withdrawal_requests(user_id,wallet_id,amount,status,payout_fee,created_at,updated_at)
    SELECT md5('t11-owner-'||n)::uuid,md5('t11-wallet-'||n)::uuid,10,
      CASE WHEN n%4=0 THEN 'completed' WHEN n%4=1 THEN 'pending' ELSE 'rejected' END,
      CASE WHEN n%4=0 THEN (n%5+1)::numeric/100 ELSE 0 END,now()-interval '8 days',now()
    FROM generate_series(1,${sampleSize}) n;
    INSERT INTO public.affiliate_guest_commission_reviews(attribution_id,status,created_at,decided_at)
    VALUES(md5('t11-attribution-5')::uuid,'pending',now()-interval '3 days',NULL),
      (md5('t11-attribution-10')::uuid,'released',now()-interval '10 minutes',now()-interval '5 minutes');
    INSERT INTO public.affiliate_guest_commission_review_events(action,created_at)
    VALUES('released',now()-interval '5 minutes'),('rejected',now()-interval '6 minutes');
    INSERT INTO public.payments(id,order_id,method,amount,status)
    VALUES(md5('t11-payment-1')::uuid,md5('t11-order-1')::uuid,'synthetic',1,'succeeded'),
      (md5('t11-payment-2')::uuid,md5('t11-order-2')::uuid,'synthetic',1,'succeeded'),
      (md5('t11-payment-3')::uuid,md5('t11-order-3')::uuid,'synthetic',1,'succeeded');
    INSERT INTO public.refunds(payment_id,order_id,amount,status,created_at,processed_at)
    VALUES(md5('t11-payment-1')::uuid,md5('t11-order-1')::uuid,1,'pending',now()-interval '4 days',NULL),
      (md5('t11-payment-2')::uuid,md5('t11-order-2')::uuid,1,'approved',now()-interval '3 days',NULL),
      (md5('t11-payment-3')::uuid,md5('t11-order-3')::uuid,1,'processed',now()-interval '10 minutes',now()-interval '5 minutes');
  `);

  await sql(`UPDATE app_private.financial_health_snapshot SET computed_at=now()-interval '61 seconds' WHERE singleton`);
  const loadedHealth = await health();
  const cacheStarted = process.hrtime.bigint();
  const cachedHealth = await health();
  const cacheReadMs = Number(process.hrtime.bigint() - cacheStarted) / 1_000_000;
  assert.equal(cachedHealth.computedAt, loadedHealth.computedAt, 'a fresh shared snapshot avoids another full aggregation');
  const afterTotals = await sourceTotals();
  const expected = { wallet_pending_sen: 0, available_sen: 0, reserved_sen: 0, affiliate_pending_sen: 0,
    affiliate_confirmed_sen: 0, refunded_confirmed_sen: 0, recommendation_confirmed_sen: 0, payout_fees_sen: 0 };
  for (let n = 1; n <= sampleSize; n += 1) {
    const attributionSen = (n % 9 + 1) * 10;
    expected.wallet_pending_sen += n % 7 + (n % 10 === 0 ? attributionSen : 0);
    expected.available_sen += n;
    expected.reserved_sen += n % 3;
    if (n % 10 === 5) expected.affiliate_pending_sen += attributionSen;
    if (n % 5 === 1) {
      expected.affiliate_confirmed_sen += attributionSen;
      if (n % 100 === 1) expected.refunded_confirmed_sen += attributionSen;
    }
    if (n % 3 === 1) expected.recommendation_confirmed_sen += (n % 11 + 1) * 100;
    if (n % 4 === 0) expected.payout_fees_sen += n % 5 + 1;
  }
  for (const key of Object.keys(expected)) {
    assert.equal(money(afterTotals[key]) - money(baselineTotals[key]), expected[key], `${key} matches independent fixture arithmetic`);
  }
  assert.equal(money(afterTotals.refund_shortfalls_sen) - money(baselineTotals.refund_shortfalls_sen), 0);
  assert.equal(money(loadedHealth.liabilitiesSen.pendingEarnings) - money(baselineHealth.liabilitiesSen.pendingEarnings),
    expected.wallet_pending_sen + expected.affiliate_pending_sen);
  assert.equal(money(loadedHealth.liabilitiesSen.availableEarnings) - money(baselineHealth.liabilitiesSen.availableEarnings), expected.available_sen);
  assert.equal(money(loadedHealth.liabilitiesSen.reservedEarnings) - money(baselineHealth.liabilitiesSen.reservedEarnings), expected.reserved_sen);
  assert.equal(money(loadedHealth.economicsSen.refundClawbackShortfall) - money(baselineHealth.economicsSen.refundClawbackShortfall), 0);
  assert.equal(money(loadedHealth.economicsSen.postMaturityExposure) - money(baselineHealth.economicsSen.postMaturityExposure), expected.refunded_confirmed_sen);
  assert.equal(money(loadedHealth.economicsSen.stackedRewardCost) - money(baselineHealth.economicsSen.stackedRewardCost),
    expected.affiliate_confirmed_sen + expected.recommendation_confirmed_sen);
  assert.equal(money(loadedHealth.economicsSen.payoutFees) - money(baselineHealth.economicsSen.payoutFees), expected.payout_fees_sen);
  assert.ok(loadedHealth.queues.affiliateClearing.pending >= sampleSize / 5);
  assert.ok(loadedHealth.queues.guestReview.pending >= 1);
  assert.ok(loadedHealth.queues.refundPending.pending >= 2);
  assert.ok(loadedHealth.queues.withdrawalReview.pending >= 1);

  await sql("SET statement_timeout='4s'");
  let plan;
  try {
    await sql(`UPDATE app_private.financial_health_snapshot SET computed_at=now()-interval '61 seconds' WHERE singleton`);
    await setServiceRole();
    try {
      plan = (await sql(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
        SELECT public.financial_operations_health()`)).rows[0]['QUERY PLAN'][0];
    } finally {
      await asDatabaseOwner();
    }
  } finally {
    await sql('SET statement_timeout=0');
  }
  const executionMs = Number(plan['Execution Time']);
  assert.ok(executionMs < 4000, `100,000 synthetic rows per source should fit the existing 4s RPC budget (observed ${executionMs}ms)`);
  assert.equal(loadedHealth.availability, 'partial', 'unsupported cash and margin sources must remain explicitly partial');
  const diagnostics = {};
  const diagnosticQueries = {
    affiliateClearing: `SELECT jsonb_build_object('pending',count(*) FILTER (WHERE status='pending' AND created_at<=now()-interval '7 days'),
      'entered',count(*) FILTER (WHERE created_at>=now()-interval '1 hour'),
      'completed',count(*) FILTER (WHERE status='confirmed' AND cleared_at>=now()-interval '1 hour'))
      FROM public.affiliate_attributions
      WHERE (status='pending' AND (created_at<=now()-interval '7 days' OR created_at>=now()-interval '1 hour'))
        OR (status='confirmed' AND cleared_at>=now()-interval '1 hour')`,
    withdrawalQueues: `SELECT count(*) FILTER (WHERE status IN ('pending','pending_second_approval','hold','overdue')),
      count(*) FILTER (WHERE status='processing') FROM public.withdrawal_requests
      WHERE status IN ('pending','pending_second_approval','hold','overdue','processing') OR updated_at>=now()-interval '1 hour'`,
    walletAndAttributionTotals: `WITH wallet_totals AS (SELECT coalesce(sum(pending_earnings_sen),0) pending,
      coalesce(sum(earnings_sen),0) available,coalesce(sum(reserved_earnings_sen),0) reserved FROM public.wallets),
      attribution_totals AS (SELECT coalesce(sum(round(commission_amount*100)) FILTER (WHERE status='pending' AND hold_until IS NULL),0) pending,
      coalesce(sum(round(commission_amount*100)) FILTER (WHERE status='confirmed'),0) confirmed FROM public.affiliate_attributions)
      SELECT * FROM wallet_totals CROSS JOIN attribution_totals`,
  };
  for (const [name, statement] of Object.entries(diagnosticQueries)) {
    await sql("SET statement_timeout='4s'");
    try {
      const diagnosticPlan = (await sql(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement}`)).rows[0]['QUERY PLAN'][0];
      diagnostics[name] = { ms: Number(diagnosticPlan['Execution Time']), hits: diagnosticPlan.Plan['Shared Hit Blocks'] ?? 0 };
    } finally {
      await sql('SET statement_timeout=0');
    }
  }
  console.log(`PASS T11 synthetic: ${sampleSize.toLocaleString()} wallets/attributions/rewards/withdrawals; all exposed lifetime totals match independent source arithmetic; cash/net margin remain NULL; full RPC cold refresh ${executionMs.toFixed(1)}ms, fresh cache read ${cacheReadMs.toFixed(1)}ms, shared hits=${plan.Plan['Shared Hit Blocks'] ?? 0}, reads=${plan.Plan['Shared Read Blocks'] ?? 0}, component diagnostics=${JSON.stringify(diagnostics)}`);
}
