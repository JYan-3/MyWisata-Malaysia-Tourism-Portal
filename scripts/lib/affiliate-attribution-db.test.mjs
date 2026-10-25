import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { asRole, withOwnedFlowDb } from './owned-flow-db.mjs';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const migration = await fs.readFile(path.join(repo, 'supabase/migrations/20261025041102_affiliate_attribution_limits.sql'), 'utf8');
const runtime = path.resolve(process.argv[2] ?? '/tmp/mywisata-commerce-pg-runtime');
if (/^[a-z]+:/i.test(process.argv[2] ?? '')) throw new Error('Only a local embedded PostgreSQL runtime is accepted');

// Start an isolated ephemeral PostgreSQL cluster and point the shared DB helper
// at it. The application environment is deliberately removed before children
// are spawned, so no remote database credentials can be inherited.
const runtimeEnv = { PATH: process.env.PATH ?? '', LANG: 'C', TMPDIR: os.tmpdir() };
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, runtimeEnv);
const { default: getBinaries } = await import(pathToFileURL(path.join(runtime, 'node_modules/embedded-postgres/dist/binary.js')).href);
const binaries = await getBinaries();
if (process.platform === 'darwin') {
  const native = path.join(runtime, `node_modules/@embedded-postgres/darwin-${process.arch}/native`);
  const aliases = JSON.parse(await fs.readFile(path.join(native, 'pg-symlinks.json'), 'utf8'));
  for (const { source, target } of aliases) {
    const library = path.basename(source);
    const alias = path.join(native, 'lib', path.basename(target));
    try { await fs.symlink(library, alias); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const cluster = await fs.mkdtemp(path.join(os.tmpdir(), 'mywisata-affiliate-pg-'));
let postgres;
let postgresClosed;
const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env: runtimeEnv, stdio: 'ignore', ...options });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`local PostgreSQL utility exited (${code})`)));
});
await run(binaries.initdb, ['-D', path.join(cluster, 'data'), '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8']);
await new Promise((resolve, reject) => {
  postgres = spawn(binaries.postgres, ['-D', path.join(cluster, 'data'), '-p', String(port), '-h', '127.0.0.1', '-k', cluster], { env: runtimeEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  postgresClosed = new Promise((done) => postgres.once('close', done));
  const timer = setTimeout(() => reject(new Error('local PostgreSQL startup timeout')), 15_000);
  postgres.once('error', (error) => { clearTimeout(timer); reject(error); });
  postgres.once('close', () => { clearTimeout(timer); reject(new Error('local PostgreSQL exited during startup')); });
  postgres.stderr.on('data', (data) => {
    if (String(data).includes('ready to accept connections')) { clearTimeout(timer); resolve(); }
  });
});
process.env.OWNED_FLOW_TEST_DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/postgres`;
console.log(`started disposable affiliate PostgreSQL on loopback:${port}`);

after(async () => {
  if (postgres?.exitCode === null && postgres.signalCode === null) postgres.kill('SIGINT');
  if (postgresClosed) await postgresClosed;
  await fs.rm(cluster, { recursive: true, force: true });
  await assert.rejects(() => fs.access(cluster), { code: 'ENOENT' });
  console.log('disposable affiliate PostgreSQL stopped and removed');
});

test('affiliate owner monthly cap serializes concurrent different orders and keeps order replay unique', async () => {
  await withOwnedFlowDb(async ({ db, connect }) => {
    await db.query(`
      CREATE TABLE public.users(id uuid PRIMARY KEY, tier text, kyc_status text, email text, full_name text, email_verified_at timestamptz, status text DEFAULT 'active');
      CREATE TABLE public.orders(id uuid PRIMARY KEY, user_id uuid, guest_subject_id uuid, contact_email text, status text, total_amount numeric, created_at timestamptz DEFAULT now());
      CREATE TABLE public.affiliate_links(id uuid PRIMARY KEY, user_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true, affiliate_code text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.vendors(id uuid PRIMARY KEY, owner_id uuid NOT NULL, status text NOT NULL);
      CREATE TABLE public.outlet_managers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
      CREATE TABLE public.affiliate_fraud_flags(
        id uuid PRIMARY KEY, link_id uuid, user_id uuid, order_id uuid, flag_type text,
        severity text, detail jsonb, status text, created_at timestamptz, reviewed_at timestamptz
      );
      CREATE TABLE public.affiliate_clicks(id uuid PRIMARY KEY, link_id uuid NOT NULL, ip_hash text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.affiliate_attributions(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), click_id uuid NOT NULL, order_id uuid NOT NULL,
        commission_rate numeric NOT NULL, commission_amount numeric NOT NULL,
        status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
        hold_until timestamptz, reversed_at timestamptz, rejected_at timestamptz, rejected_by uuid,
        cleared_at timestamptz, confirmed_at timestamptz
      );
      CREATE TABLE public.platform_settings(key text PRIMARY KEY, value text);
      CREATE TABLE public.wallets(user_id uuid PRIMARY KEY);
      CREATE FUNCTION public.credit_earnings(uuid,bigint,uuid,text) RETURNS void LANGUAGE sql AS $$ SELECT; $$;
      CREATE FUNCTION app_private.confirm_pending_earnings() RETURNS integer LANGUAGE plpgsql AS $$
        BEGIN PERFORM 1 FROM public.users u WHERE true AND u.kyc_status = 'approved'; RETURN 0; END;
      $$;
      INSERT INTO public.users(id,tier,kyc_status,email,email_verified_at,status)
      VALUES ('00000000-0000-0000-0000-000000000001', 'limited', 'pending', 'affiliate@example.test', now(), 'active');
      INSERT INTO public.affiliate_links VALUES
        ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', true),
        ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', true),
        ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', true);
      INSERT INTO public.affiliate_clicks VALUES
        ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', now()),
        ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000012', now()),
        ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000013', now());
      INSERT INTO public.platform_settings VALUES ('affiliate.cookie_days', '30');
      INSERT INTO public.orders(id,user_id,status,total_amount,created_at) VALUES
        ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000099','paid',1,now()),
        ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000099','paid',266.67,now()),
        ('00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000099','paid',266.67,now()),
        ('00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000099','paid',1,now());
      INSERT INTO public.affiliate_attributions(click_id,order_id,commission_rate,commission_amount,status)
      VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000031',0.03,85,'pending'),
        ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000034',0.03,5,'confirmed');
    `);
    await db.query(migration);
    await db.query(await fs.readFile(path.join(repo, 'supabase/migrations/20261025041419_affiliate_guest_commission_review.sql'), 'utf8'));
    await db.query(await fs.readFile(path.join(repo, 'supabase/migrations/20261025041829_affiliate_maturity_exposure.sql'), 'utf8'));
    await db.query(await fs.readFile(path.join(repo, 'supabase/migrations/20261025045647_affiliate_processing_bounds.sql'), 'utf8'));

    const first = await connect();
    const second = await connect();
    await Promise.all([
      asRole(first, 'service_role'),
      asRole(second, 'service_role'),
    ]);
    await db.query(`
      INSERT INTO public.affiliate_fraud_flags(id,link_id,user_id,order_id,flag_type,severity,detail,status,created_at)
      SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000011',
        '00000000-0000-0000-0000-000000000001', NULL,
        CASE WHEN n % 2 = 0 THEN 'click_velocity' ELSE 'visitor_clustering' END,
        CASE WHEN n % 3 = 0 THEN 'high' ELSE 'low' END,
        jsonb_build_object('sample',n), CASE WHEN n % 4 = 0 THEN 'reviewed' ELSE 'open' END,
        now() - make_interval(secs => n)
      FROM generate_series(1,26) n;
    `);
    const { rows: flagPage } = await first.query(`SELECT public.get_affiliate_fraud_flag_page() AS result`);
    assert.equal(flagPage[0].result.total, 20);
    assert.equal(flagPage[0].result.items.length, 10);
    assert.equal(flagPage[0].result.page, 1);
    const { rows: flagFiltered } = await first.query(
      `SELECT public.get_affiliate_fraud_flag_page($1,$2,$3,$4,$5,$6) AS result`,
      [2, 10, 'click_velocity', 'low', 'open', 'affiliate@example.test'],
    );
    assert.equal(flagFiltered[0].result.items.length, 0);
    assert.equal(flagFiltered[0].result.total, 5);
    const tierSignals = (await first.query(
      `SELECT public.affiliate_tier_signals($1) AS result`,
      ['00000000-0000-0000-0000-000000000001'],
    )).rows[0].result;
    assert.equal(tierSignals.click_count, 3);
    assert.equal(tierSignals.referral_count, 1);
    assert.equal(Number(tierSignals.sales_amount_sen), 100);
    const sweepClaim = (await first.query(
      `SELECT public.claim_affiliate_job($1,$2,600) AS result`,
      ['fraud_sweep', new Date().toISOString()],
    )).rows[0].result;
    assert.equal(sweepClaim.outcome, 'claimed');
    const concurrentSweepClaim = (await second.query(
      `SELECT public.claim_affiliate_job($1,$2,600) AS result`,
      ['fraud_sweep', new Date().toISOString()],
    )).rows[0].result;
    assert.equal(concurrentSweepClaim.outcome, 'busy');
    const sweepBatch = (await first.query(
      `SELECT public.get_affiliate_fraud_sweep_batch($1,$2,50) AS result`,
      [sweepClaim.token, new Date(Date.now() - 60_000).toISOString()],
    )).rows[0].result;
    assert.equal(sweepBatch.length, 3);
    assert.equal(Number(sweepBatch.find((row) => row.id === '00000000-0000-0000-0000-000000000011').total_clicks), 1);
    const sweepLast = sweepBatch.at(-1);
    assert.equal((await first.query(
      `SELECT public.advance_affiliate_job($1,$2,$3,$4,true,true) AS result`,
      ['fraud_sweep', sweepClaim.token, sweepLast.created_at, sweepLast.id],
    )).rows[0].result, true);

    const clearingClaim = (await first.query(
      `SELECT public.claim_affiliate_job($1,$2,600) AS result`,
      ['clearing', new Date().toISOString()],
    )).rows[0].result;
    const clearingBatch = (await first.query(
      `SELECT public.get_affiliate_pending_clear_batch($1,$2,1) AS result`,
      ['clearing', clearingClaim.token],
    )).rows[0].result;
    assert.equal(clearingBatch.length, 1);
    const clearingCursor = clearingBatch.at(-1);
    assert.equal((await first.query(
      `SELECT public.advance_affiliate_job($1,$2,$3,$4,false,false) AS result`,
      ['clearing', clearingClaim.token, clearingCursor.created_at, clearingCursor.id],
    )).rows[0].result, true);
    await db.query(`UPDATE app_private.affiliate_job_progress SET lease_expires_at=now()-interval '1 second' WHERE scope='clearing'`);
    const resumedClearing = (await second.query(
      `SELECT public.claim_affiliate_job($1,$2,600) AS result`,
      ['clearing', new Date().toISOString()],
    )).rows[0].result;
    assert.equal(resumedClearing.outcome, 'claimed');
    assert.equal(resumedClearing.cursor_id, clearingCursor.id);
    assert.equal((await second.query(
      `SELECT public.get_affiliate_pending_clear_batch($1,$2,1) AS result`,
      ['clearing', resumedClearing.token],
    )).rows[0].result.length, 0);
    assert.equal((await second.query(
      `SELECT public.advance_affiliate_job($1,$2,NULL,NULL,true,true) AS result`,
      ['clearing', resumedClearing.token],
    )).rows[0].result, true);
    await assert.rejects(
      first.query(`SELECT public.get_affiliate_fraud_flag_page(1,11,NULL,NULL,NULL,NULL)`),
      /affiliate_flag_page_input_invalid/,
    );
    const calls = await Promise.all([
      first.query(`SELECT public.create_affiliate_attribution($1,$2,$3) AS result`, [
        '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000021', 0.03,
      ]),
      second.query(`SELECT public.create_affiliate_attribution($1,$2,$3) AS result`, [
        '00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000022', 0.03,
      ]),
    ]);
    const createdIndex = calls.findIndex(({ rows }) => rows[0].result.outcome === 'created');
    const outcomes = calls.map(({ rows }) => rows[0].result.outcome).sort();
    assert.deepEqual(outcomes, ['created', 'monthly_cap_reached']);
    const { rows: totals } = await db.query(`
      SELECT sum(commission_amount) AS amount, count(*) AS rows
      FROM public.affiliate_attributions aa
      JOIN public.affiliate_clicks c ON c.id=aa.click_id
      JOIN public.affiliate_links l ON l.id=c.link_id
      WHERE l.user_id='00000000-0000-0000-0000-000000000001'
        AND aa.status IN ('pending','confirmed')
    `);
    assert.equal(Number(totals[0].amount), 98);
    assert.equal(Number(totals[0].rows), 3);

    await db.query(`
      INSERT INTO public.users(id,tier,kyc_status,email,email_verified_at,status)
      VALUES ('00000000-0000-0000-0000-000000000002','limited','pending','vendor@example.test',now(),'active');
      INSERT INTO public.affiliate_links VALUES ('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000002',true);
      INSERT INTO public.affiliate_clicks VALUES ('00000000-0000-0000-0000-000000000027','00000000-0000-0000-0000-000000000014',now());
      INSERT INTO public.orders(id,user_id,status,total_amount,created_at)
      VALUES ('00000000-0000-0000-0000-000000000038','00000000-0000-0000-0000-000000000099','paid',10,now());
      INSERT INTO public.vendors(id,owner_id,status)
      VALUES ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000002','pending');
    `);
    const { rows: ineligible } = await first.query(
      `SELECT public.create_affiliate_attribution($1,$2,$3) AS result`,
      ['00000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-000000000027', 0.03],
    );
    assert.equal(ineligible[0].result.outcome, 'skipped');
    await db.query(`DELETE FROM public.vendors WHERE id='00000000-0000-0000-0000-000000000041'`);

    const { rows: replay } = await first.query(
      `SELECT public.create_affiliate_attribution($1,$2,$3) AS result`,
      [
        createdIndex === 0 ? '00000000-0000-0000-0000-000000000032' : '00000000-0000-0000-0000-000000000033',
        createdIndex === 0 ? '00000000-0000-0000-0000-000000000021' : '00000000-0000-0000-0000-000000000022',
        0.03,
      ],
    );
    assert.equal(replay[0].result.outcome, 'existing');

    const ordinary = await connect();
    await asRole(ordinary, 'authenticated');
    await assert.rejects(
      ordinary.query(`SELECT public.create_affiliate_attribution($1,$2,$3)`, [
        '00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000022', 0.03,
      ]),
      /permission denied for function create_affiliate_attribution/,
    );

    await db.query(`
      INSERT INTO public.orders(id,user_id,guest_subject_id,contact_email,status,total_amount,created_at) VALUES
        ('00000000-0000-0000-0000-000000000035',NULL,'00000000-0000-0000-0000-000000000051','affiliate@example.test','paid',1,now()),
        ('00000000-0000-0000-0000-000000000036',NULL,'00000000-0000-0000-0000-000000000052','different@example.test','paid',1,now()),
        ('00000000-0000-0000-0000-000000000037',NULL,'00000000-0000-0000-0000-000000000053','affiliate@example.test','paid',1,now());
      INSERT INTO public.affiliate_clicks(id,link_id,created_at) VALUES
        ('00000000-0000-0000-0000-000000000024','00000000-0000-0000-0000-000000000011',now()),
        ('00000000-0000-0000-0000-000000000025','00000000-0000-0000-0000-000000000012',now()),
        ('00000000-0000-0000-0000-000000000026','00000000-0000-0000-0000-000000000013',now());
    `);
    const { rows: guest } = await first.query(
      `SELECT public.create_affiliate_attribution($1,$2,$3) AS result`,
      ['00000000-0000-0000-0000-000000000035', '00000000-0000-0000-0000-000000000024', 0.03],
    );
    assert.equal(guest[0].result.outcome, 'created');
    const guestAttributionId = guest[0].result.attribution_id;
    const { rows: held } = await first.query(`SELECT public.clear_affiliate_commission($1,NULL) AS result`, [guestAttributionId]);
    assert.equal(held[0].result.outcome, 'review_required');
    const { rows: resolved } = await first.query(
      `SELECT public.resolve_guest_affiliate_commission_review($1,$2,$3,$4) AS result`,
      [guestAttributionId, 1, 'release', '00000000-0000-0000-0000-000000000001'],
    );
    assert.equal(resolved[0].result.outcome, 'resolved');
    assert.equal(resolved[0].result.version, 2);
    const { rows: audit } = await db.query(`SELECT version,action FROM public.affiliate_guest_commission_review_events WHERE attribution_id=$1 ORDER BY version`, [guestAttributionId]);
    assert.deepEqual(audit.map((row) => [row.version, row.action]), [[1, 'held'], [2, 'released']]);
    const { rows: stale } = await first.query(
      `SELECT public.resolve_guest_affiliate_commission_review($1,$2,$3,$4) AS result`,
      [guestAttributionId, 1, 'reject', '00000000-0000-0000-0000-000000000001'],
    );
    assert.equal(stale[0].result.outcome, 'stale');
    const { rows: usualGuest } = await first.query(
      `SELECT public.create_affiliate_attribution($1,$2,$3) AS result`,
      ['00000000-0000-0000-0000-000000000036', '00000000-0000-0000-0000-000000000025', 0.03],
    );
    assert.equal(usualGuest[0].result.outcome, 'created');
    const { rows: ordinaryReviewCount } = await db.query(`SELECT count(*)::int AS count FROM public.affiliate_guest_commission_reviews`);
    assert.equal(ordinaryReviewCount[0].count, 1);
    const { rows: secondGuest } = await first.query(
      `SELECT public.create_affiliate_attribution($1,$2,$3) AS result`,
      ['00000000-0000-0000-0000-000000000037', '00000000-0000-0000-0000-000000000026', 0.03],
    );
    const rejectedAttributionId = secondGuest[0].result.attribution_id;
    const { rows: rejected } = await first.query(
      `SELECT public.resolve_guest_affiliate_commission_review($1,$2,$3,$4) AS result`,
      [rejectedAttributionId, 1, 'reject', '00000000-0000-0000-0000-000000000001'],
    );
    assert.equal(rejected[0].result.outcome, 'resolved');
    assert.equal((await db.query(`SELECT status FROM public.affiliate_attributions WHERE id=$1`, [rejectedAttributionId])).rows[0].status, 'rejected');
    assert.equal((await db.query(`SELECT action FROM public.affiliate_guest_commission_review_events WHERE attribution_id=$1 ORDER BY version DESC LIMIT 1`, [rejectedAttributionId])).rows[0].action, 'rejected');
    const legacy = await db.query(`SELECT pg_get_functiondef('app_private.confirm_pending_earnings()'::regprocedure) AS source`);
    assert.match(legacy.rows[0].source, /affiliate_guest_commission_reviews/);
    await db.query(`UPDATE public.orders SET status='refunded' WHERE id='00000000-0000-0000-0000-000000000034'`);
    const { rows: exposure } = await first.query(`SELECT public.affiliate_maturity_exposure() AS result`);
    assert.equal(exposure[0].result.pending.count, 4);
    assert.equal(Number(exposure[0].result.pending.amount_rm), 93.06);
    assert.equal(exposure[0].result.confirmed_on_refunded_orders.count, 1);
    assert.equal(Number(exposure[0].result.confirmed_on_refunded_orders.amount_rm), 5);

    await db.query(`
      INSERT INTO public.users(id,tier,kyc_status,email,email_verified_at,status)
      VALUES ('00000000-0000-0000-0000-000000000003','kyc_verified','approved','clearing@example.test',now(),'active');
      INSERT INTO public.affiliate_links VALUES ('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000003',true);
      INSERT INTO public.affiliate_clicks VALUES ('00000000-0000-0000-0000-000000000028','00000000-0000-0000-0000-000000000015',now());
      INSERT INTO public.orders(id,user_id,status,total_amount,created_at)
      VALUES ('00000000-0000-0000-0000-000000000039','00000000-0000-0000-0000-000000000099','paid',10,now());
      INSERT INTO public.affiliate_attributions(click_id,order_id,commission_rate,commission_amount,status,created_at)
      VALUES ('00000000-0000-0000-0000-000000000028','00000000-0000-0000-0000-000000000039',0.03,0.3,'pending',now()-interval '8 days');
      INSERT INTO public.vendors(id,owner_id,status)
      VALUES ('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000003','suspended');
    `);
    const clearingAttributionId = (await db.query(`SELECT id FROM public.affiliate_attributions WHERE order_id='00000000-0000-0000-0000-000000000039'`)).rows[0].id;
    const { rows: vendorClearing } = await first.query(`SELECT public.clear_affiliate_commission($1,NULL) AS result`, [clearingAttributionId]);
    assert.equal(vendorClearing[0].result.outcome, 'skipped');

    await db.query(`
      ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS target_type text;
      ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS target_id uuid;
      ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS source text;
      ALTER TABLE public.affiliate_clicks ADD COLUMN IF NOT EXISTS campaign text;
      ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS display_id text;
      ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS earnings_sen bigint NOT NULL DEFAULT 0;
      CREATE TABLE public.products(id uuid PRIMARY KEY, slug text UNIQUE, name text NOT NULL);
      CREATE TABLE public.share_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), affiliate_id uuid, content_type text, content_id uuid, platform text, created_at timestamptz DEFAULT now());
      CREATE TABLE public.commission_rules(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_type text, is_active boolean,
        tier_name text, min_conversions integer, min_sales_amount_sen bigint,
        active_period_days integer, max_fraud_rate_percent numeric
      );
      CREATE TABLE public.recommendation_conversions(id uuid PRIMARY KEY, converted_vendor_id uuid);
      CREATE TABLE public.vendor_recommendations(id uuid PRIMARY KEY, vendor_name text);
      CREATE TABLE public.recommendation_commissions(
        id uuid PRIMARY KEY, recommender_id uuid, conversion_id uuid, commission_type text,
        amount numeric, commission_rate numeric, status text, hold_until timestamptz,
        created_at timestamptz, order_id uuid
      );
      INSERT INTO public.products(id,slug,name) VALUES
        ('00000000-0000-4000-8000-000000000071','t9-scale','T9ScaleListing');
      INSERT INTO public.affiliate_clicks(id,link_id,target_type,target_id,created_at) VALUES
        ('00000000-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000011','product','00000000-0000-4000-8000-000000000071','2026-10-24T12:00:00Z'),
        ('00000000-0000-4000-8000-000000000082','00000000-0000-0000-0000-000000000012','product','00000000-0000-4000-8000-000000000071','2026-10-24T12:00:00Z');
      INSERT INTO public.orders(id,user_id,status,total_amount,display_id,created_at)
      SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
        '00000000-0000-0000-0000-000000000099','paid',10,'T9-'||n,'2026-10-24T12:00:00Z'
      FROM generate_series(1,1105) n;
      INSERT INTO public.affiliate_attributions(click_id,order_id,commission_rate,commission_amount,status,created_at)
      SELECT CASE WHEN n % 2 = 0 THEN '00000000-0000-4000-8000-000000000081'::uuid ELSE '00000000-0000-4000-8000-000000000082'::uuid END,
        ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,0.03,1,'pending','2026-10-24T12:00:00Z'
      FROM generate_series(1,1105) n;
      INSERT INTO public.commission_rules(rule_type,is_active,tier_name,min_conversions,min_sales_amount_sen)
      VALUES('affiliate',true,'standard',0,0);
      ANALYZE public.affiliate_attributions;
      ANALYZE public.affiliate_clicks;
    `);
    await db.query(await fs.readFile(path.join(repo, 'supabase/migrations/20261025090821_bounded_financial_history_reads.sql'), 'utf8'));
    const summaryBefore = (await first.query(`SELECT public.get_affiliate_admin_summary() AS value`)).rows[0].value;
    assert.ok(summaryBefore.totals.totalReferrals >= 1105);

    const t9Cutoff = '2026-10-25T12:00:00Z';
    const ownerPage = (await first.query(
      `SELECT public.get_affiliate_earnings_page($1,NULL,$2,50,NULL,NULL) AS value`,
      ['00000000-0000-0000-0000-000000000001', t9Cutoff],
    )).rows[0].value;
    assert.ok(ownerPage.totalCount >= 1105, 'SQL totals must cover rows beyond the PostgREST default');
    assert.equal(ownerPage.commissions.length, 50);
    assert.equal(ownerPage.hasMore, true);
    assert.ok(ownerPage.nextCursor);

    const adminPage = (await first.query(
      `SELECT public.get_admin_affiliate_attribution_page($1,$2,$3,$4,$5,$6,$7) AS value`,
      [t9Cutoff, 'pending', 'T9ScaleListing', 'createdAt', 'desc', 10, null],
    )).rows[0].value;
    assert.equal(Number(adminPage.totalCount), 1105);
    assert.equal(adminPage.items.length, 10);
    assert.equal(adminPage.hasMore, true);
    const nextAdminPage = (await first.query(
      `SELECT public.get_admin_affiliate_attribution_page($1,$2,$3,$4,$5,$6,$7) AS value`,
      [t9Cutoff, 'pending', 'T9ScaleListing', 'createdAt', 'desc', 10, adminPage.nextCursor],
    )).rows[0].value;
    assert.equal(nextAdminPage.totalCount, 1105);
    assert.equal(nextAdminPage.items.length, 10);
    assert.equal(new Set([...adminPage.items, ...nextAdminPage.items].map((row) => row.id)).size, 20,
      'keyset pages with identical timestamps must not duplicate rows');
    const roles = (await db.query(`SELECT
      has_function_privilege('anon','public.get_admin_affiliate_attribution_page(timestamptz,text,text,text,text,integer,jsonb)','EXECUTE') AS anon_exec,
      has_function_privilege('authenticated','public.get_affiliate_earnings_page(uuid,timestamptz,timestamptz,integer,timestamptz,uuid)','EXECUTE') AS authenticated_exec,
      has_function_privilege('service_role','public.get_affiliate_earnings_page(uuid,timestamptz,timestamptz,integer,timestamptz,uuid)','EXECUTE') AS service_exec`)).rows[0];
    assert.equal(roles.anon_exec, false);
    assert.equal(roles.authenticated_exec, false);
    assert.equal(roles.service_exec, true);
    console.log('PASS affiliate: T9 database aggregation and keyset pages cover 1,105 rows with stable duplicate-timestamp cursors and service-only ACL');
  });
});
