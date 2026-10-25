/**
 * Synthetic finance acceptance against actual SQL functions in a disposable
 * embedded PostgreSQL cluster. No application env file or remote DB is read.
 * Install the pinned external runtime described in the acceptance plan, then:
 * node scripts/lib/commerce-risk-db.test.mjs [local-runtime-directory]
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeVersion = '17.10.0-beta.17';
const passed = (label) => console.log(`PASS commerce risk: ${label}`);

// Only dependency tables/columns are supplied here. Settlement, reversal,
// provenance, fee calculation and reporting always come from repository SQL.
const supportSchema = `
  CREATE SCHEMA IF NOT EXISTS app_private;
  GRANT USAGE ON SCHEMA auth, app_private TO anon, authenticated, service_role;
  ALTER TABLE public.orders DROP CONSTRAINT orders_status_check;
  ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
    CHECK (lower(status) IN ('draft','pending_payment','paid','completed','cancelled','refunded','chargeback','fraud'));
  ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false;
  ALTER TABLE public.withdrawal_requests
    ADD COLUMN IF NOT EXISTS payout_fee numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS destination_provider text;
  ALTER TABLE public.payout_destinations ADD COLUMN IF NOT EXISTS provider text;
  CREATE TABLE IF NOT EXISTS public.withdrawal_risk_assessments (
    withdrawal_id uuid, risk_level text
  );
  CREATE TABLE IF NOT EXISTS public.monthly_payout_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start date NOT NULL UNIQUE,
    timezone text NOT NULL,
    summary jsonb NOT NULL,
    generated_at timestamptz NOT NULL,
    generated_by text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS public.recommendation_conversions (
    id uuid PRIMARY KEY, converted_vendor_id uuid
  );
  CREATE TABLE IF NOT EXISTS public.recommendation_commissions (
    conversion_id uuid, order_id uuid, amount numeric, status text
  );
`;

export async function verifyCommerceRisk({ db, query }) {
  const sql = (text, values = []) => query(db, text, values);
  const apply = async (file) => sql(await fs.readFile(path.join(repo, file), 'utf8'));
  await sql(supportSchema);
  // Event tests have already checked the event-patched reversal. Preserve that
  // patch while installing provenance and the current tier-aware settlement.
  await apply('supabase/migrations/20261002145304_close_order_financial_lifecycle.sql');
  await apply('supabase/migrations/20261007230000_vendor_platform_fee_tiers.sql');
  await apply('supabase/legacy-migrations/089_payout_report_pending_amounts.sql');
  await apply('supabase/migrations/20261004083124_private_generate_monthly_payout_report.sql');
  await apply('supabase/migrations/20261016022142_commerce_risk_exposure.sql');
  await sql(`ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid_effects_processed_at timestamptz;
    CREATE INDEX IF NOT EXISTS orders_paid_effects_pending_idx ON public.orders(created_at)
      WHERE paid_effects_processed_at IS NULL AND status IN ('paid', 'completed')`);
  await apply('supabase/migrations/20261025090817_paid_order_effects_retry_progress.sql');
  await sql(`SELECT set_config('request.jwt.claim.sub','',false),
    set_config('request.jwt.claim.role','service_role',false)`);
  assert.equal(Number((await sql('SELECT count(*) FROM public.settlement_clawback_shortfalls')).rows[0].count), 0,
    'previous event fixtures must not contaminate shortfall assertions');
  passed('actual provenance, tier settlement, event reversal and private report SQL installed');

  async function createPaidOrder(isLive = true) {
    const owner = crypto.randomUUID();
    const vendor = crypto.randomUUID();
    const outlet = crypto.randomUUID();
    const order = crypto.randomUUID();
    await sql(`INSERT INTO public.users(id,email,full_name) VALUES($1,$2,'Synthetic finance case')`,
      [owner, `${owner}@example.test`]);
    await sql(`INSERT INTO public.vendors(id,owner_id,name,slug,status)
      VALUES($1::uuid,$2,'Synthetic vendor',$1::uuid::text,'approved')`, [vendor, owner]);
    await sql(`INSERT INTO public.outlets(id,vendor_id,name,slug)
      VALUES($1::uuid,$2,'Synthetic outlet',$1::uuid::text)`, [outlet, vendor]);
    await sql(`INSERT INTO public.orders(id,user_id,status,subtotal,total_amount)
      VALUES($1,$2,'pending_payment',100,100)`, [order, owner]);
    await sql(`INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total)
      VALUES($1,$2,$3,'Synthetic fixture item',100,1,100)`, [order, vendor, outlet]);
    // is_live is a local provenance fixture only; no provider is contacted.
    await sql(`INSERT INTO public.payments(order_id,method,provider,amount,status,is_live)
      VALUES($1,'fixture_only','fixture_only',100,'succeeded',$2)`, [order, isLive]);
    await sql(`UPDATE public.orders SET status='paid',paid_at=now() WHERE id=$1`, [order]);
    await sql(`SET ROLE service_role`);
    try {
      await sql(`SELECT public.settle_order_vendor_earnings($1)`, [order]);
    } finally {
      await sql('RESET ROLE');
    }
    const settlements = await sql(`SELECT vendor_net_sen::int net,is_simulated FROM public.order_settlements WHERE order_id=$1`, [order]);
    assert.equal(settlements.rowCount, 1, 'payment status and repeated settle must create one settlement');
    assert.deepEqual(settlements.rows[0], { net: 8500, is_simulated: !isLive });
    return { owner, vendor, order };
  }

  await sql(`UPDATE public.orders SET paid_effects_processed_at = now()`);
  const retryCase = await createPaidOrder(false);
  const starvationIds = Array.from({ length: 51 }, () => crypto.randomUUID());
  await sql(`INSERT INTO public.orders(id,user_id,status,subtotal,total_amount,created_at)
    SELECT id,$1,'paid',100,100,now() - make_interval(secs => n)
    FROM unnest($2::uuid[]) WITH ORDINALITY AS batch(id,n)`, [retryCase.owner, starvationIds]);
  await sql(`SET ROLE service_role`);
  let claimed;
  try {
    claimed = await sql(`SELECT * FROM public.claim_paid_order_effects(50)`);
    assert.equal(claimed.rowCount, 50, 'one invocation must stay within its 50-order cap');
    for (const row of claimed.rows) {
      const finished = await sql(`SELECT public.finish_paid_order_effects($1,$2,false,'synthetic_failure') AS finished`,
        [row.order_id, row.lease_token]);
      assert.equal(finished.rows[0].finished, true);
    }
    const nextBatch = await sql(`SELECT * FROM public.claim_paid_order_effects(50)`);
    assert.equal(nextBatch.rowCount, 2, 'failed older work must back off so the remaining orders can proceed');
    const staleToken = await sql(`SELECT public.finish_paid_order_effects($1,$2,true,NULL) AS finished`,
      [claimed.rows[0].order_id, claimed.rows[0].lease_token]);
    assert.equal(staleToken.rows[0].finished, false, 'a lease token cannot finish after its claim was released');
  } finally {
    await sql('RESET ROLE');
  }
  for (const role of ['anon', 'authenticated']) {
    await sql(`SET ROLE ${role}`);
    try {
      await assert.rejects(() => sql(`SELECT * FROM public.claim_paid_order_effects(1)`), { code: '42501' });
    } finally {
      await sql('RESET ROLE');
    }
  }
  passed('paid-order retry claim is bounded, backoffs failures, and fences stale leases');

  async function wallet(owner) {
    return (await sql(`SELECT pending_earnings_sen::int pending,earnings_sen::int earnings
      FROM public.wallets WHERE user_id=$1`, [owner])).rows[0] ?? { pending: 0, earnings: 0 };
  }

  const cases = [];
  for (const outcome of ['refunded', 'chargeback', 'fraud']) {
    for (const stage of ['held', 'available', 'spent']) {
      const row = await createPaidOrder();
      assert.deepEqual(await wallet(row.owner), { pending: 8500, earnings: 0 });
      if (stage !== 'held') {
        await sql(`UPDATE public.order_settlements SET hold_until=now()-interval '1 day' WHERE order_id=$1`, [row.order]);
        await sql('SET ROLE service_role');
        try {
          await sql('SELECT * FROM public.clear_matured_vendor_settlements(false)');
        } finally {
          await sql('RESET ROLE');
        }
        assert.deepEqual(await wallet(row.owner), { pending: 0, earnings: 8500 });
      }
      if (stage === 'spent') {
        // Model already-consumed funds inside the disposable ledger only.
        await sql(`UPDATE public.wallets SET earnings_sen=2000 WHERE user_id=$1`, [row.owner]);
        await sql(`INSERT INTO public.wallet_transactions(user_id,wallet_id,order_id,type,amount_sen,bucket,direction,note)
          SELECT user_id,id,$2,'adjustment_debit',6500,'earnings','debit','Synthetic prior consumption; no payout'
          FROM public.wallets WHERE user_id=$1`, [row.owner, row.order]);
      }
      await sql(`UPDATE public.orders SET status=$2 WHERE id=$1`, [row.order, outcome]);
      assert.deepEqual(await wallet(row.owner), { pending: 0, earnings: 0 });
      const expectedShortfall = stage === 'spent' ? 6500 : 0;
      const beforeReplay = (await sql(`SELECT count(*)::int count,coalesce(sum(shortfall_sen),0)::int amount
        FROM public.settlement_clawback_shortfalls WHERE order_id=$1`, [row.order])).rows[0];
      assert.deepEqual(beforeReplay, { count: expectedShortfall ? 1 : 0, amount: expectedShortfall });
      const settlement = (await sql(`SELECT status,reversed_amount_sen::int reversed FROM public.order_settlements WHERE order_id=$1`, [row.order])).rows[0];
      assert.deepEqual(settlement, { status: 'reversed', reversed: 8500 });
      const debitsBefore = Number((await sql(`SELECT count(*) FROM public.wallet_transactions WHERE order_id=$1`, [row.order])).rows[0].count);
      // Replay the same status, then a different adverse status and the RPC.
      await sql(`UPDATE public.orders SET status=$2 WHERE id=$1`, [row.order, outcome]);
      await sql(`UPDATE public.orders SET status=$2 WHERE id=$1`, [row.order, outcome === 'fraud' ? 'refunded' : 'fraud']);
      await sql('SET ROLE service_role');
      try {
        await sql(`SELECT public.reverse_order_vendor_settlement($1,NULL)`, [row.order]);
      } finally {
        await sql('RESET ROLE');
      }
      assert.deepEqual(await wallet(row.owner), { pending: 0, earnings: 0 });
      assert.deepEqual((await sql(`SELECT count(*)::int count,coalesce(sum(shortfall_sen),0)::int amount
        FROM public.settlement_clawback_shortfalls WHERE order_id=$1`, [row.order])).rows[0], beforeReplay);
      assert.equal(Number((await sql(`SELECT count(*) FROM public.wallet_transactions WHERE order_id=$1`, [row.order])).rows[0].count), debitsBefore,
        'replayed adverse events must not insert another debit');
      cases.push(row);
      passed(`${outcome}/${stage}: covered debit or exact 6500-sen shortfall; replay has no duplicate effect`);
    }
    const simulated = await createPaidOrder(false);
    assert.deepEqual(await wallet(simulated.owner), { pending: 0, earnings: 0 });
    await sql(`UPDATE public.orders SET status=$2 WHERE id=$1`, [simulated.order, outcome]);
    assert.equal(Number((await sql(`SELECT count(*) FROM public.settlement_clawback_shortfalls WHERE order_id=$1`, [simulated.order])).rows[0].count), 0);
    assert.equal((await sql(`SELECT status FROM public.order_settlements WHERE order_id=$1`, [simulated.order])).rows[0].status, 'reversed');
    passed(`${outcome}/simulated: no wallet income or shortfall`);
  }

  // Boundary fixtures are separate from reversal assertions: the ledger has no
  // production recovery workflow, so resolved_at here is synthetic input only.
  const source = cases[0];
  for (const [amount, createdAt, resolved] of [
    [1111, '2025-01-31T15:59:59.999999Z', false],
    [2222, '2025-01-31T16:00:00Z', false],
    [3333, '2025-02-28T15:59:59.999999Z', true],
    [4444, '2025-02-28T16:00:00Z', false],
  ]) {
    await sql(`INSERT INTO public.settlement_clawback_shortfalls(order_id,vendor_id,shortfall_sen,created_at,resolved_at)
      VALUES($1,$2,$3,$4::timestamptz,CASE WHEN $5 THEN now() END)`,
    [source.order, source.vendor, amount, createdAt, resolved]);
  }

  async function generateReport() {
    await sql('SET ROLE service_role');
    try {
      return (await sql(`SELECT public.generate_monthly_payout_report('2025-02-01','scheduler') AS report`)).rows[0].report;
    } finally {
      await sql('RESET ROLE');
    }
  }
  const report = await generateReport();
  assert.equal(report.period_start, '2025-02-01');
  assert.equal(report.period_end, '2025-03-01');
  assert.equal(report.summary.vendor_clawback_shortfall_month_rm, 55.55);
  assert.equal(report.summary.vendor_clawback_shortfall_month_count, 2);
  assert.equal(report.summary.vendor_clawback_open_shortfall_rm, 272.77);
  assert.equal(report.summary.vendor_clawback_open_shortfall_count, 6);
  passed('MYT month is half-open (55.55 RM / 2); current open includes other months (272.77 RM / 6)');

  await sql(`INSERT INTO public.settlement_clawback_shortfalls(order_id,vendor_id,shortfall_sen)
    VALUES($1,$2,500)`, [source.order, source.vendor]);
  const regenerated = await generateReport();
  assert.equal(regenerated.report_id, report.report_id);
  assert.equal(regenerated.summary.vendor_clawback_shortfall_month_rm, 55.55);
  assert.equal(regenerated.summary.vendor_clawback_open_shortfall_rm, 277.77);
  assert.equal(regenerated.summary.vendor_clawback_open_shortfall_count, 7);
  assert.equal(Number((await sql(`SELECT count(*) FROM public.monthly_payout_reports WHERE period_start='2025-02-01'`)).rows[0].count), 1);
  passed('same-month regeneration updates one report with current open shortfalls');

  for (const role of ['anon', 'authenticated']) {
    await sql(`SET ROLE ${role}`);
    try {
      for (const fn of ['public.generate_monthly_payout_report', 'app_private.generate_monthly_payout_report']) {
        await assert.rejects(() => sql(`SELECT ${fn}('2025-02-01','scheduler')`), { code: '42501' });
      }
      await assert.rejects(() => sql(`SELECT public.reverse_order_vendor_settlement($1,NULL)`, [source.order]), { code: '42501' });
    } finally {
      await sql('RESET ROLE');
    }
    passed(`${role}: public/private report and reversal RPC execution denied`);
  }
  const { verifyAffiliateClearing } = await import('./affiliate-clearing-db.mjs');
  await verifyAffiliateClearing({ db, query });
  const { verifyStaffAccess } = await import('./staff-access-db.mjs');
  await verifyStaffAccess({ db, query });
  const { verifyFinancialReconciliation } = await import('./financial-reconciliation-db.test.mjs');
  await verifyFinancialReconciliation({ query: sql });
  const { verifyFinancialOperationsHealth } = await import('./financial-operations-health-db.test.mjs');
  await verifyFinancialOperationsHealth({ query: sql });
  console.log('commerce risk dynamic acceptance passed (synthetic only; no platform-cash or reserve certification)');
}

async function availableLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function runIsolatedAcceptance() {
  const runtimeInput = process.env.COMMERCE_EMBEDDED_PG_RUNTIME ?? process.argv[2]
    ?? '/tmp/mywisata-commerce-pg-runtime';
  const failStartup = process.env.COMMERCE_TEST_FAIL_STARTUP === '1';
  const checkoutAcceptance = process.env.COMMERCE_TEST_CHECKOUT === '1';
  if (/^[a-z]+:/i.test(runtimeInput)) throw new Error('Only a local embedded PostgreSQL runtime directory is accepted.');
  // The runtime itself spawns native binaries. Sanitize this standalone CLI
  // process too, before loading it, so no DB/app secrets reach any descendant.
  const runtimeEnv = { PATH: process.env.PATH ?? '', LANG: 'C', TMPDIR: os.tmpdir() };
  if (process.platform === 'win32' && process.env.SystemRoot) runtimeEnv.SystemRoot = process.env.SystemRoot;
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, runtimeEnv);
  assert.deepEqual(Object.keys(process.env).sort(), Object.keys(runtimeEnv).sort());
  const runtime = path.resolve(runtimeInput);
  const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'node_modules/embedded-postgres/package.json'), 'utf8'));
  assert.equal(manifest.version, runtimeVersion, `Use the pinned embedded-postgres@${runtimeVersion} runtime`);
  // The pinned package supplies native binaries. Manage their processes here:
  // its start/stop implementation can miss an exit after failed startup.
  const { default: getBinaries } = await import(pathToFileURL(path.join(runtime, 'node_modules/embedded-postgres/dist/binary.js')).href);
  const binaries = await getBinaries();

  // Match the existing KYC harness: lifecycle scripts are disabled at install,
  // so restore only package-declared, local dylib aliases on macOS.
  if (process.platform === 'darwin') {
    const native = path.join(runtime, `node_modules/@embedded-postgres/darwin-${process.arch}/native`);
    const aliases = JSON.parse(await fs.readFile(path.join(native, 'pg-symlinks.json'), 'utf8'));
    for (const { source, target } of aliases) {
      const alias = path.join(native, 'lib', path.basename(target));
      const library = path.basename(source);
      await fs.access(path.join(native, 'lib', library));
      try { await fs.symlink(library, alias); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }
  const port = await availableLoopbackPort();
  const clusterRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mywisata-commerce-pg-'));
  const databaseDir = path.join(clusterRoot, 'data');
  const passwordFile = path.join(clusterRoot, 'password');
  const password = crypto.randomBytes(24).toString('hex');
  const diagnostics = [];
  let server;
  let serverClosed;
  let activeChild;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    activeChild?.kill('SIGTERM');
    server?.kill('SIGINT');
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  const runChild = (command, args, options) => new Promise((resolve, reject) => {
    if (interrupted) { reject(new Error('local acceptance interrupted')); return; }
    const child = spawn(command, args, options);
    activeChild = child;
    let output = '';
    child.stdout?.on('data', (data) => { output = (output + data).slice(-2000); });
    child.stderr?.on('data', (data) => { output = (output + data).slice(-2000); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      activeChild = undefined;
      if (code === 0 && !interrupted) resolve();
      else reject(new Error(`local acceptance child failed (${signal ?? code}): ${output}`));
    });
  });

  try {
    await fs.writeFile(passwordFile, password, { mode: 0o600 });
    try {
      await runChild(binaries.initdb,
        ['-D', databaseDir, '-U', 'postgres', '--pwfile', passwordFile,
          '--auth=scram-sha-256', '--no-locale', '--encoding=UTF8'],
        { env: runtimeEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 });
    } finally {
      await fs.rm(passwordFile, { force: true });
    }
    if (interrupted) throw new Error('local acceptance interrupted');
    await new Promise((resolve, reject) => {
      server = spawn(binaries.postgres, ['-D', databaseDir, '-p', String(port),
        '-c', 'listen_addresses=127.0.0.1', '-c', `unix_socket_directories=${clusterRoot}`,
        ...(failStartup ? ['-c', 'mywisata_invalid_startup_setting=1'] : [])],
      { env: runtimeEnv, stdio: ['ignore', 'ignore', 'pipe'] });
      const timer = setTimeout(() => reject(new Error('local PostgreSQL startup timeout')), 15_000);
      // Observe close immediately, including a failed startup, and reuse this
      // promise at shutdown rather than waiting on an already-fired event.
      serverClosed = new Promise((closed) => server.once('close', closed));
      server.once('error', (error) => { clearTimeout(timer); reject(error); });
      server.once('close', () => { clearTimeout(timer); reject(new Error('local PostgreSQL exited during startup')); });
      server.stderr.on('data', (data) => {
        const message = String(data);
        diagnostics.push(message);
        if (diagnostics.length > 3) diagnostics.shift();
        if (message.includes('database system is ready to accept connections')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    console.log(`started disposable PostgreSQL 17.10 on loopback:${port}; remote env is not inherited`);
    await runChild(process.execPath, [path.join(repo, 'scripts/test-event-management-db.mjs')], {
        cwd: repo,
        // An allowlist keeps application secrets, remote DB URLs and retention
        // flags out of the child. Its only target is this newly created cluster.
        env: {
          PATH: process.env.PATH,
          LANG: 'C',
          EVENT_TEST_PGHOST: '127.0.0.1', EVENT_TEST_PGPORT: String(port),
          EVENT_TEST_PGUSER: 'postgres', EVENT_TEST_PGPASSWORD: password,
          EVENT_TEST_PGDATABASE: 'postgres',
          EVENT_TEST_GUARANTEES: 'patched', EVENT_TEST_SETTLEMENT: 'patched',
          EVENT_TEST_FILTERS: 'patched',
          EVENT_TEST_COMMERCE_RISK: '1',
          ...(checkoutAcceptance ? { EVENT_TEST_CHECKOUT_LAYOUT: 'guest', EVENT_TEST_BUYER_GUARDS: '1' } : {}),
        },
        stdio: 'inherit',
        timeout: 120_000,
      });
  } catch (error) {
    if (diagnostics.length) console.error('local PostgreSQL diagnostics:', diagnostics.join('\n'));
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (server) {
      if (server.exitCode === null && server.signalCode === null) server.kill('SIGINT');
      const forceStop = setTimeout(() => server.kill('SIGKILL'), 2000);
      try { await serverClosed; }
      finally { clearTimeout(forceStop); }
    }
    await fs.rm(clusterRoot, { recursive: true, force: true });
    await assert.rejects(() => fs.access(clusterRoot), { code: 'ENOENT' });
    console.log('disposable finance PostgreSQL stopped; cluster files removed');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runIsolatedAcceptance();
}
