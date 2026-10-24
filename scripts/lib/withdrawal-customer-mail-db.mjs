/** Synthetic transaction/outbox schema + actual migration; loopback only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const runtime = path.resolve(process.argv[2] ?? '/tmp/mylawatan-db-runtime');
if (/^[a-z]+:/i.test(process.argv[2] ?? '')) throw new Error('local_runtime_required');
const env = { PATH: process.env.PATH ?? '', LANG: 'C', TMPDIR: os.tmpdir() };
const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'node_modules/embedded-postgres/package.json'), 'utf8'));
assert.equal(manifest.version, '17.10.0-beta.17');
const { default: getBinaries } = await import(pathToFileURL(path.join(runtime, 'node_modules/embedded-postgres/dist/binary.js')).href);
const binaries = await getBinaries();
const port = await new Promise((resolve, reject) => {
  const listener = net.createServer(); listener.once('error', reject);
  listener.listen(0, '127.0.0.1', () => { const selected = listener.address().port; listener.close(() => resolve(selected)); });
});
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mylawatan-withdrawal-mail-pg-'));
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
  const sql = (query, values) => db.query(query, values);
  await sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA app_private;
    CREATE TABLE public.users(id uuid PRIMARY KEY,email text,full_name text,preferred_locale text);
    CREATE TABLE public.withdrawal_requests(id uuid PRIMARY KEY,user_id uuid NOT NULL,amount numeric NOT NULL,status text NOT NULL,created_at timestamptz DEFAULT now());
    CREATE TABLE public.email_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_key text UNIQUE NOT NULL,user_id uuid,to_email text NOT NULL,
      event_type text NOT NULL,payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',next_attempt_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now());`);
  await sql(await fs.readFile('supabase/migrations/20261024051246_durable_withdrawal_customer_mail.sql', 'utf8'));
  const user = '11111111-1111-4111-8111-111111111111';
  await sql("INSERT INTO public.users VALUES($1,'customer@example.test','Synthetic customer','zh-CN')", [user]);
  const requestId = '22222222-2222-4222-8222-222222222222';
  await sql('BEGIN');
  await sql("INSERT INTO public.withdrawal_requests(id,user_id,amount,status) VALUES($1,$2,75,'pending')", [requestId, user]);
  await sql('ROLLBACK');
  assert.equal(Number((await sql('SELECT count(*) AS n FROM public.email_outbox')).rows[0].n), 0);

  await sql("INSERT INTO public.withdrawal_requests(id,user_id,amount,status) VALUES($1,$2,75,'pending')", [requestId, user]);
  let rows = (await sql('SELECT event_key,to_email,event_type,payload FROM public.email_outbox ORDER BY event_key')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_key, `withdrawal_submitted:${requestId}`);
  assert.equal(rows[0].to_email, 'customer@example.test');
  assert.equal(rows[0].event_type, 'withdrawal_submitted');
  assert.equal(rows[0].payload.locale, 'zh-CN');
  assert.equal(Number(rows[0].payload.amountRm), 75);

  await sql("UPDATE public.withdrawal_requests SET status='approved' WHERE id=$1", [requestId]);
  assert.equal(Number((await sql("SELECT count(*) AS n FROM public.email_outbox WHERE event_type='withdrawal_approved'")).rows[0].n), 0);
  await sql("UPDATE public.withdrawal_requests SET status='processing' WHERE id=$1", [requestId]);
  await sql("UPDATE public.withdrawal_requests SET status='processing' WHERE id=$1", [requestId]);
  rows = (await sql('SELECT event_key,to_email,event_type,payload FROM public.email_outbox ORDER BY event_key')).rows;
  assert.equal(rows.length, 2);
  const approved = rows.find((row) => row.event_type === 'withdrawal_approved');
  assert.equal(approved.event_key, `withdrawal_approved:${requestId}`);
  assert.equal(approved.to_email, 'customer@example.test');
  assert.equal(approved.payload.locale, 'zh-CN');
  assert.equal(Number(approved.payload.amountRm), 75);

  const missingEmailId = '33333333-3333-4333-8333-333333333333';
  await sql("INSERT INTO public.users VALUES($1,NULL,'No email','en')", [missingEmailId]);
  await assert.rejects(() => sql("INSERT INTO public.withdrawal_requests(id,user_id,amount,status) VALUES($1,$2,5,'pending')", [
    '44444444-4444-4444-8444-444444444444', missingEmailId,
  ]), /withdrawal_email_recipient_unavailable/);
  assert.equal(Number((await sql('SELECT count(*) AS n FROM public.withdrawal_requests')).rows[0].n), 1);
  console.log('PASS withdrawal mail intents commit/rollback atomically, snapshot recipient/locale, deduplicate status replay, and fail closed without recipient');
} finally {
  await db?.end().catch(() => undefined);
  if (server) {
    server.kill('SIGINT'); const timer = setTimeout(() => server.kill('SIGKILL'), 2000);
    try { await closed; } finally { clearTimeout(timer); }
  }
  await fs.rm(root, { recursive: true, force: true });
  console.log('Disposable PostgreSQL stopped and removed');
}
