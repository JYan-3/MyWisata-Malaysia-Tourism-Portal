/** Actual SQL acceptance; called only by the disposable loopback finance harness. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';

export async function verifyAffiliateClearing({ db, query }) {
  const sql = (text, values = []) => query(db, text, values);
  assert.ok(['127.0.0.1', '::1', 'localhost'].includes(db.connectionParameters.host));
  await sql(`ALTER TABLE public.affiliate_attributions
    ADD COLUMN IF NOT EXISTS hold_until timestamptz,
    ADD COLUMN IF NOT EXISTS cleared_at timestamptz,
    ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
    ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tier text DEFAULT 'kyc_verified';`);
  const credit = await fs.readFile('supabase/migrations/20261002143855_harden_internal_wallet_rpc_access.sql', 'utf8');
  await sql(credit.slice(0, credit.indexOf('CREATE OR REPLACE FUNCTION public.credit_pending_earnings')));
  await sql(await fs.readFile('supabase/migrations/20261023000636_atomic_affiliate_commission_clearing.sql', 'utf8'));
  await sql(`SELECT set_config('request.jwt.claim.role','service_role',false)`);

  async function seed({ kyc = 'approved', status = 'paid', legacy = false } = {}) {
    const owner = crypto.randomUUID(); const order = crypto.randomUUID();
    const link = crypto.randomUUID(); const click = crypto.randomUUID(); const attribution = crypto.randomUUID();
    await sql(`INSERT INTO public.users(id,email,full_name,email_verified_at,kyc_status,tier,status)
      VALUES($1,$2,'Synthetic affiliate',now(),$3,'kyc_verified','active')`, [owner, `${owner}@example.test`, kyc]);
    await sql(`INSERT INTO public.wallets(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, [owner]);
    await sql(`INSERT INTO public.orders(id,user_id,status,subtotal,total_amount) VALUES($1,$2,$3,100,100)`, [order, owner, status]);
    await sql(`INSERT INTO public.affiliate_links(id,user_id,affiliate_code) VALUES($1,$2,$3)`, [link, owner, link]);
    await sql(`INSERT INTO public.affiliate_clicks(id,link_id) VALUES($1,$2)`, [click, link]);
    await sql(`INSERT INTO public.affiliate_attributions(id,click_id,order_id,commission_rate,commission_amount,created_at,hold_until)
      VALUES($1,$2,$3,0.03,3,now()-interval '10 days',CASE WHEN $4 THEN now()-interval '1 day' ELSE NULL END)`, [attribution, click, order, legacy]);
    return { owner, attribution };
  }
  const clear = (client, id, cutoff = null) => query(client,
    'SELECT public.clear_affiliate_commission($1,$2) AS result', [id, cutoff]).then((result) => result.rows[0].result);
  async function state(item) {
    return (await sql(`SELECT a.status,w.earnings_sen::int AS balance,
      (SELECT count(*)::int FROM public.wallet_transactions t WHERE t.user_id=$2 AND t.type='earnings') AS credits
      FROM public.affiliate_attributions a JOIN public.wallets w ON w.user_id=$2 WHERE a.id=$1`, [item.attribution, item.owner])).rows[0];
  }

  const failure = await seed();
  await sql(`CREATE FUNCTION pg_temp.fail_affiliate_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic_ledger_failure'; END $$;
    CREATE TRIGGER affiliate_test_failure BEFORE INSERT ON public.wallet_transactions
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_affiliate_ledger();`);
  try { await assert.rejects(() => clear(db, failure.attribution), /synthetic_ledger_failure/); }
  finally { await sql('DROP TRIGGER affiliate_test_failure ON public.wallet_transactions'); }
  assert.deepEqual(await state(failure), { status: 'pending', balance: 0, credits: 0 });
  assert.equal((await clear(db, failure.attribution)).outcome, 'confirmed');
  assert.equal((await clear(db, failure.attribution)).outcome, 'skipped');
  assert.deepEqual(await state(failure), { status: 'confirmed', balance: 300, credits: 1 });
  console.log('PASS affiliate: failed ledger rolls back; retry and replay produce exactly one credit');

  for (const options of [{ kyc: 'pending' }, { legacy: true }]) {
    const item = await seed(options);
    assert.equal((await clear(db, item.attribution)).outcome, 'skipped');
    assert.deepEqual(await state(item), { status: 'pending', balance: 0, credits: 0 });
  }
  const immature = await seed();
  assert.equal((await clear(db, immature.attribution, '2000-01-01T00:00:00Z')).outcome, 'skipped');
  const cancelled = await seed({ status: 'cancelled' });
  assert.equal((await clear(db, cancelled.attribution)).outcome, 'reversed');
  assert.deepEqual(await state(cancelled), { status: 'reversed', balance: 0, credits: 0 });

  for (const role of ['anon', 'authenticated']) {
    await sql(`SET ROLE ${role}`);
    try { await assert.rejects(() => clear(db, immature.attribution), { code: '42501' }); }
    finally { await sql('RESET ROLE'); }
  }
  await sql(`SELECT set_config('request.jwt.claim.role','authenticated',false)`);
  try { await assert.rejects(() => clear(db, immature.attribution), { code: '42501' }); }
  finally { await sql(`SELECT set_config('request.jwt.claim.role','service_role',false)`); }
  console.log('PASS affiliate: eligibility/maturity/legacy boundaries and browser/runtime ACL');

  const competing = await seed();
  const config = db.connectionParameters;
  const clients = [new pg.Client({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database }),
    new pg.Client({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database })];
  const [a, b] = clients;
  let second;
  try {
    await Promise.all(clients.map((client) => client.connect()));
    await Promise.all(clients.map((client) => client.query("SELECT set_config('request.jwt.claim.role','service_role',false)")));
    await a.query('BEGIN');
    assert.equal((await clear(a, competing.attribution)).outcome, 'confirmed');
    second = clear(b, competing.attribution);
    let blocked = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      blocked = (await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') AS blocked`, [b.processID])).rows[0].blocked;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(blocked, 'second transaction must actually compete on a held row');
    await a.query('COMMIT');
    assert.equal((await second).outcome, 'skipped');
    assert.deepEqual(await state(competing), { status: 'confirmed', balance: 300, credits: 1 });
    console.log('PASS affiliate: two competing database transactions credit only once');
  } finally {
    await a.query('ROLLBACK').catch(() => undefined);
    await second?.catch(() => undefined);
    await Promise.all(clients.map((client) => client.end()));
  }
}
