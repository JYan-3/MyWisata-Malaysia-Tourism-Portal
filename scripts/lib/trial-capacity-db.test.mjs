/** Remote-like pre-applied approval schema plus the narrow runtime migration; loopback only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const runtime = path.resolve(process.argv[2] ?? '/tmp/mywisata-commerce-pg-runtime');
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
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mywisata-runtime-pg-'));
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
    CREATE SCHEMA auth; CREATE SCHEMA app_private; CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA public,app_private TO anon,authenticated,service_role;
    CREATE FUNCTION app_private.require_kyc_job_service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      IF current_setting('request.test.role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF; END; $$;
    CREATE TABLE public.users(id uuid PRIMARY KEY,email text,full_name text,preferred_locale text,status text DEFAULT 'active');
    CREATE TABLE public.user_roles(user_id uuid,role_id integer,vendor_id uuid,outlet_id uuid);
    -- Canonical permission resolution is a controllable dependency here; its
    -- actual implementation has separate staff-governance acceptance coverage.
    CREATE FUNCTION public.has_staff_permission(p_id uuid,p_key text) RETURNS boolean LANGUAGE sql AS $$ SELECT p_key='admin.withdrawal.approve' AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_id AND role_id=1); $$;
    CREATE TABLE public.withdrawal_requests(id uuid PRIMARY KEY,user_id uuid,amount numeric,status text,approval_cycle integer DEFAULT 1);
    -- These are the approval queue objects already present on the target project.
    CREATE TABLE app_private.withdrawal_approver_jobs(withdrawal_id uuid,cycle integer,stage text,cursor_id uuid,completed boolean DEFAULT false,attempts integer DEFAULT 0,token uuid,lease_until timestamptz,available_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),PRIMARY KEY(withdrawal_id,cycle,stage));
    ALTER TABLE app_private.withdrawal_approver_jobs ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION app_private.withdrawal_approver_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status IN ('pending','pending_second_approval') THEN INSERT INTO app_private.withdrawal_approver_jobs(withdrawal_id,cycle,stage) VALUES(NEW.id,coalesce(NEW.approval_cycle,1),NEW.status) ON CONFLICT DO NOTHING; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER withdrawal_approver_intent AFTER INSERT OR UPDATE OF status,approval_cycle ON public.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION app_private.withdrawal_approver_intent();
    CREATE TABLE public.vendor_recommendations(id uuid PRIMARY KEY,recommender_id uuid,created_at timestamptz,status text);
    GRANT INSERT ON public.vendor_recommendations TO authenticated;
    CREATE TABLE public.recommendation_images(id uuid PRIMARY KEY,owner_id uuid,storage_path text,is_staged boolean,recommendation_id uuid,created_at timestamptz DEFAULT now(),removed_at timestamptz);
    CREATE TABLE public.places(id uuid PRIMARY KEY,status text,lat numeric,lng numeric);
    CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb DEFAULT '{}'::jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY recommendation_images_storage_owner_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (true);
    CREATE TABLE public.kyc_prescreening_jobs(status text,created_at timestamptz,finished_at timestamptz,lease_expires_at timestamptz);
    CREATE TABLE public.kyc_submissions(status text,created_at timestamptz,reviewed_at timestamptz);
    CREATE TABLE public.email_outbox(status text,created_at timestamptz);
    SELECT set_config('request.test.role','service_role',false);`);
  await sql("INSERT INTO public.withdrawal_requests VALUES('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000020',75,'pending',1)");
  assert.equal((await sql("SELECT to_regprocedure('public.claim_portal_workload(text,uuid)') IS NULL AS missing")).rows[0].missing, true);
  const retainedApproverDefinition = (await sql("SELECT md5(pg_get_functiondef('app_private.withdrawal_approver_intent()'::regprocedure)) AS hash")).rows[0].hash;
  await sql("INSERT INTO public.recommendation_images(id,owner_id,storage_path,is_staged,created_at) VALUES('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000040/staged/existing.jpg',true,now()-interval '25 hours')");
  await sql("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('recommendation-images','00000000-0000-4000-8000-000000000040/staged/existing.jpg','{\"size\":\"1234\"}'),('recommendation-images','orphan/object.jpg','{\"size\":\"42\"}')");
  await sql(await fs.readFile('supabase/migrations/20261024051033_complete_portal_runtime_dependencies.sql', 'utf8'));
  assert.equal((await sql('SELECT count(*)::int n FROM app_private.withdrawal_approver_jobs')).rows[0].n, 1);
  assert.equal((await sql("SELECT md5(pg_get_functiondef('app_private.withdrawal_approver_intent()'::regprocedure)) AS hash")).rows[0].hash, retainedApproverDefinition);
  assert.equal((await sql("SELECT stored_bytes FROM public.recommendation_images WHERE id='00000000-0000-4000-8000-000000000041'")).rows[0].stored_bytes, 1234);
  await sql("UPDATE public.recommendation_images SET is_staged=false WHERE id='00000000-0000-4000-8000-000000000041'");
  await sql('UPDATE app_private.withdrawal_approver_jobs SET completed=true');

  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  assert.equal((await sql('SELECT public.claim_portal_workload($1,$2) AS value', ['kyc_upload', id(1)])).rows[0].value, true);
  assert.equal((await sql('SELECT public.claim_portal_workload($1,$2) AS value', ['kyc_upload', id(2)])).rows[0].value, false);
  await sql('SELECT public.release_portal_workload($1,$2)', ['kyc_upload', id(2)]);
  assert.equal((await sql('SELECT count(*)::int n FROM app_private.portal_workload_slots')).rows[0].n, 1);
  await sql('SELECT public.release_portal_workload($1,$2)', ['kyc_upload', id(1)]);
  assert.equal((await sql('SELECT public.claim_portal_workload($1,$2) AS value', ['kyc_upload', id(2)])).rows[0].value, true);
  for (const role of ['anon', 'authenticated']) {
    await sql(`SET ROLE ${role}`);
    await assert.rejects(() => sql('SELECT public.claim_portal_workload($1,$2)', ['trip_ai', id(3)]), /permission denied/);
    await sql('RESET ROLE');
  }
  assert.equal((await sql("SELECT has_table_privilege('authenticated','public.vendor_recommendations','INSERT') AS value")).rows[0].value, false);
  await sql('SELECT public.reserve_staged_recommendation_image($1,$2,100,$3)', [id(10), id(11), 'jpg']);
  assert.equal((await sql('SELECT public.complete_staged_recommendation_image($1,$2) AS value', [id(11), id(10)])).rows[0].value, false);
  await sql('INSERT INTO storage.objects(bucket_id,name,metadata) VALUES($1,$2,$3)', ['recommendation-images', `${id(10)}/staged/${id(11)}.jpg`, '{"size":"100"}']);
  assert.equal((await sql('SELECT public.complete_staged_recommendation_image($1,$2) AS value', [id(11), id(10)])).rows[0].value, true);
  await sql("UPDATE public.recommendation_images SET created_at=now()-interval '25 hours'");
  assert.equal((await sql('SELECT * FROM public.claim_staged_recommendation_cleanup()')).rowCount, 1);
  assert.equal((await sql('SELECT public.complete_staged_recommendation_image($1,$2) AS value', [id(11), id(10)])).rows[0].value, false);
  // Formal binding wins before cleanup: it must never be returned as work.
  await sql('INSERT INTO public.recommendation_images(id,owner_id,storage_path,is_staged,recommendation_id,created_at,stored_bytes) VALUES($1,$2,$3,false,$4,now()-interval \'30 hours\',100)', [id(12), id(10), 'formal-proof', id(13)]);
  assert.equal((await sql('SELECT * FROM public.claim_staged_recommendation_cleanup()')).rowCount, 1);
  await sql('SELECT public.finish_staged_recommendation_cleanup($1)', [[id(11), id(12)]]);
  assert.equal((await sql('SELECT count(*)::int n FROM public.recommendation_images WHERE is_staged')).rows[0].n, 0);
  assert.equal((await sql('SELECT count(*)::int n FROM public.recommendation_images WHERE recommendation_id IS NOT NULL')).rows[0].n, 1);
  await sql('INSERT INTO public.users(id,email) VALUES($1,$2),($3,$4)', [id(20), 'customer@example.test', id(21), 'reviewer@example.test']);
  await sql('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,1)', [id(21)]);
  await sql("INSERT INTO public.withdrawal_requests VALUES($1,$2,75,'pending',1)", [id(22), id(20)]);
  assert.equal((await sql('SELECT count(*)::int n FROM app_private.withdrawal_approver_jobs WHERE NOT completed')).rows[0].n, 1);
  assert.equal((await sql("SELECT count(*)::int n FROM pg_trigger WHERE tgname='withdrawal_approver_intent' AND NOT tgisinternal")).rows[0].n, 1);
  // Independent connections contend for the actual advisory-locked slot.
  const other = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', statement_timeout: 8000 });
  await other.connect();
  try {
    await other.query("SELECT set_config('request.test.role','service_role',false)");
    await sql('DELETE FROM app_private.portal_workload_slots');
    const claims = await Promise.all([sql('SELECT public.claim_portal_workload($1,$2) AS value', ['kyc_upload',id(31)]), other.query('SELECT public.claim_portal_workload($1,$2) AS value', ['kyc_upload',id(32)])]);
    assert.equal(claims.filter((result) => result.rows[0].value).length, 1);
  } finally { await other.end(); }
  await sql("SELECT public.record_portal_dispatch('kyc','started'),public.record_portal_dispatch('kyc','succeeded')");
  const health = (await sql('SELECT public.portal_queue_health() AS value')).rows[0].value;
  assert.ok(health.dispatches.kyc.lastSucceededAt);
  assert.ok(!JSON.stringify(health).includes('@example.test'));
  assert.equal((await sql("SELECT count(*)::int n FROM storage.objects WHERE bucket_id='recommendation-images' AND name='orphan/object.jpg'")).rows[0].n, 1);
  console.log('PASS narrow migration on remote-like baseline: existing approval definition preserved, byte backfill, fenced admission, RPC ACL, staged cleanup and aggregate health');
} finally {
  await db?.end().catch(() => undefined);
  if (server) {
    server.kill('SIGINT'); const timer = setTimeout(() => server.kill('SIGKILL'), 2000);
    try { await closed; } finally { clearTimeout(timer); }
  }
  await fs.rm(root, { recursive: true, force: true });
  console.log('Disposable PostgreSQL stopped and removed');
}
