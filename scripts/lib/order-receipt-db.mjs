/** Synthetic dependencies + actual forward migration; loopback only, no app env. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const runtime = path.resolve(process.argv[2] ?? '/tmp/mylawatan-receipt-pg');
if (/^[a-z]+:/i.test(process.argv[2] ?? '')) throw new Error('local_runtime_required');
const env = { PATH: process.env.PATH ?? '', LANG: 'C', TMPDIR: os.tmpdir() };
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, env);
const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'node_modules/embedded-postgres/package.json'), 'utf8'));
assert.equal(manifest.version, '17.10.0-beta.17');
const { default: getBinaries } = await import(pathToFileURL(path.join(runtime, 'node_modules/embedded-postgres/dist/binary.js')).href);
const binaries = await getBinaries();
const port = await new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const selected = server.address().port; server.close(() => resolve(selected)); });
});
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mylawatan-receipt-pg-'));
let server, closed, db;
const child = (command, args) => new Promise((resolve, reject) => {
  const process = spawn(command, args, { env, stdio: 'ignore' });
  process.once('error', reject); process.once('close', (code) => code === 0 ? resolve() : reject(new Error('local_command_failed')));
});
try {
  await child(binaries.initdb, ['-D', root, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8']);
  await new Promise((resolve, reject) => {
    server = spawn(binaries.postgres, ['-D', root, '-p', String(port), '-h', '127.0.0.1', '-k', root], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    closed = new Promise((done) => server.once('close', done));
    const timer = setTimeout(() => reject(new Error('local_startup_timeout')), 15_000);
    server.once('error', (error) => { clearTimeout(timer); reject(error); });
    server.once('close', () => { clearTimeout(timer); reject(new Error('local_server_closed')); });
    server.stderr.on('data', (data) => { if (String(data).includes('ready to accept connections')) { clearTimeout(timer); resolve(); } });
  });
  db = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 3000, statement_timeout: 8000 });
  await db.connect();
  const sql = (text, values) => db.query(text, values);
  await sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA app_private; CREATE SCHEMA extensions;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
    CREATE TABLE public.users(id uuid PRIMARY KEY,email text,full_name text,preferred_locale text);
    CREATE FUNCTION public.is_super_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE public.audit_logs(actor_id uuid,action text,entity_type text,entity_id uuid,after_data jsonb,note text);
    CREATE TABLE public.orders(id uuid PRIMARY KEY,user_id uuid,guest_subject_id uuid,status text,contact_email text,contact_name text,contact_locale text,total_amount numeric,paid_at timestamptz);
    CREATE TABLE public.guest_order_access_tokens(order_id uuid,token_hash text,expires_at timestamptz);
    -- Synthetic crypto dependencies: this harness tests queue semantics, not cryptography.
    CREATE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(md5(random()::text)||md5(random()::text),'hex') $$;
    CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(md5($1)||md5($1),'hex') $$;`);
  await sql(await fs.readFile('supabase/legacy-migrations/048_email_outbox.sql','utf8'));
  await sql(await fs.readFile('supabase/migrations/20261014114005_email_delivery_recovery.sql','utf8'));
  const guest = await fs.readFile('supabase/migrations/20261002004603_guest_order_access.sql','utf8');
  await sql(guest.slice(guest.indexOf('CREATE FUNCTION public.queue_guest_order_access'),guest.indexOf('DO $migration$',guest.indexOf('CREATE FUNCTION public.queue_guest_order_access'))));
  await sql(await fs.readFile('supabase/migrations/20261024041354_durable_order_receipts.sql','utf8'));
  await sql(await fs.readFile('supabase/migrations/20261024041622_preserve_legacy_guest_receipt_delivery.sql','utf8'));
  await sql("SELECT set_config('request.jwt.claim.role','service_role',false)");
  const user = '11111111-1111-4111-8111-111111111111';
  await sql("INSERT INTO public.users VALUES($1,'account@example.test','Synthetic buyer','ms')",[user]);
  const insertOrder = async (id, status='pending_payment', guest=false, contact='contact@example.test') => sql(
    'INSERT INTO public.orders(id,user_id,guest_subject_id,status,contact_email,contact_name,contact_locale,total_amount) VALUES($1,$2,$3,$4,$5,$6,$7,25)',
    [id,guest?null:user,guest?user:null,status,contact,'Synthetic buyer','zh-CN']);
  const receiptCount = async () => Number((await sql('SELECT count(*) AS n FROM public.email_outbox')).rows[0].n);
  const order = '22222222-2222-4222-8222-222222222222';
  await insertOrder(order); assert.equal(await receiptCount(),0);
  await sql("UPDATE public.orders SET status='paid' WHERE id=$1",[order]);
  assert.equal(await receiptCount(),1);
  let row=(await sql('SELECT event_key,to_email,payload FROM public.email_outbox')).rows[0];
  assert.equal(row.event_key,`order-receipt:${order}`);assert.equal(row.to_email,'contact@example.test');
  assert.equal(row.payload.receiptOrderId,order);assert.equal(row.payload.locale,'zh-CN');
  await sql("UPDATE public.orders SET status='completed' WHERE id=$1",[order]);
  await sql('SELECT public.queue_order_receipt($1)',[order]);assert.equal(await receiptCount(),1);
  assert.deepEqual((await sql('SELECT public.claim_email_outbox_delivery(20) AS r')).rows[0].r.rows,[]);
  assert.equal((await sql('SELECT public.claim_email_outbox_delivery_v2(20) AS r')).rows[0].r.rows.length,1);
  await sql("UPDATE public.email_outbox SET lease_expires_at=now()-interval '1 second'");
  await sql('SELECT public.claim_email_outbox_delivery(20)');
  assert.equal(Number((await sql('SELECT attempts FROM public.email_outbox')).rows[0].attempts),1);
  assert.equal((await sql('SELECT public.claim_email_outbox_delivery_v2(20) AS r')).rows[0].r.recovered,1);
  console.log('PASS paid transaction, contact/locale snapshot, canonical deduplication and legacy-worker protection');

  await sql('TRUNCATE public.email_outbox');
  await sql('BEGIN');await insertOrder('33333333-3333-4333-8333-333333333333','paid');await sql('ROLLBACK');assert.equal(await receiptCount(),0);
  const guestOrder='44444444-4444-4444-8444-444444444444';
  await insertOrder(guestOrder,'paid',true);assert.equal(await receiptCount(),1);
  row=(await sql('SELECT payload FROM public.email_outbox')).rows[0];assert.equal(row.payload.receiptOrderId,guestOrder);assert.ok(row.payload.guestAccessToken);
  assert.equal((await sql('SELECT public.claim_email_outbox_delivery(20) AS r')).rows[0].r.rows.length,1);
  await sql("SELECT public.queue_guest_order_access($1::uuid,'guest-receipt:'||$1::text,'Your requested order receipt.')",[guestOrder]);
  row=(await sql("SELECT payload FROM public.email_outbox WHERE event_key LIKE 'guest-receipt:%'")).rows[0];assert.equal(row.payload.receiptOrderId,guestOrder);
  const hour=Math.floor(Date.now()/3_600_000);
  await sql('SELECT public.queue_order_receipt($1,$2)',[guestOrder,hour]);
  const requestedCount=await receiptCount();
  await sql('SELECT public.queue_order_receipt($1,$2)',[guestOrder,hour]);
  assert.equal(await receiptCount(),requestedCount);
  assert.equal(requestedCount,3);
  console.log('PASS transaction rollback and explicit Guest receipt marker despite reason text');

  const privileges=(await sql(`SELECT has_function_privilege('anon','public.queue_order_receipt(uuid,bigint)','execute') AS a,
    has_function_privilege('authenticated','public.queue_order_receipt(uuid,bigint)','execute') AS b,
    has_function_privilege('authenticated','public.claim_email_outbox_delivery_v2(integer)','execute') AS c`)).rows[0];
  assert.deepEqual(privileges,{a:false,b:false,c:false});
  await sql("SELECT set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(()=>sql('SELECT public.queue_order_receipt($1)',[order]),/service_role_required/);
  await sql("SELECT set_config('request.jwt.claim.role','service_role',false)");
  console.log('PASS service-only RPC and no authenticated/anonymous receipt queue access');

  await sql('TRUNCATE public.email_outbox');
  const other = new pg.Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await other.connect();
  try {
    await other.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
    await Promise.all([sql('SELECT public.queue_order_receipt($1)',[order]),other.query('SELECT public.queue_order_receipt($1)',[order])]);
    assert.equal(await receiptCount(),1);
    const claims=await Promise.all([sql('SELECT public.claim_email_outbox_delivery_v2(1) AS r'),other.query('SELECT public.claim_email_outbox_delivery_v2(1) AS r')]);
    assert.equal(claims.reduce((n,r)=>n+r.rows[0].r.rows.length,0),1);
  } finally {await other.end();}
  console.log('PASS concurrent enqueue/worker claims never duplicate a receipt task');

} finally {
  await db?.end().catch(() => undefined);
  if (server) {
    server.kill('SIGINT'); const timer = setTimeout(() => server.kill('SIGKILL'), 2000);
    try { await closed; } finally { clearTimeout(timer); }
  }
  await fs.rm(root, { recursive: true, force: true });
  console.log('Disposable PostgreSQL stopped and removed');
}
