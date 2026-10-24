/** Isolated role/module schema + actual audit migration; loopback only. */
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
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mylawatan-staff-audit-pg-'));
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
    CREATE TABLE public.staff_roles(id uuid PRIMARY KEY,name text,description text,is_active boolean,is_system boolean DEFAULT false,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.staff_modules(id uuid PRIMARY KEY,key text UNIQUE);
    CREATE TABLE public.staff_permissions(id uuid PRIMARY KEY,key text UNIQUE);
    CREATE TABLE public.staff_module_permissions(module_id uuid,permission_id uuid,PRIMARY KEY(module_id,permission_id));
    CREATE TABLE public.staff_role_modules(role_id uuid,module_id uuid,PRIMARY KEY(role_id,module_id));
    CREATE TABLE public.staff_role_permissions(role_id uuid,permission_id uuid,PRIMARY KEY(role_id,permission_id));
    CREATE TABLE public.audit_logs(actor_id uuid,action text,entity_type text,entity_id uuid,before_data jsonb,after_data jsonb,note text);
    CREATE FUNCTION public.require_active_global_staff_super_admin() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('request.test.actor')::uuid $$;
    CREATE FUNCTION public.validate_staff_reason(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF length(btrim($1)) < 10 THEN RAISE EXCEPTION 'staff_reason_required'; END IF; END $$;
    CREATE FUNCTION public.validate_staff_module_keys(text[]) RETURNS text[] LANGUAGE sql AS $$ SELECT coalesce(array_agg(DISTINCT module_key ORDER BY module_key),ARRAY[]::text[]) FROM unnest($1) AS module_key $$;
    CREATE FUNCTION public.sync_staff_role_permissions(p_role uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      DELETE FROM public.staff_role_permissions WHERE role_id=p_role;
      INSERT INTO public.staff_role_permissions(role_id,permission_id)
      SELECT role_module.role_id,module_permission.permission_id FROM public.staff_role_modules role_module
      JOIN public.staff_module_permissions module_permission ON module_permission.module_id=role_module.module_id
      WHERE role_module.role_id=p_role;
    END $$;
    CREATE FUNCTION app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RETURN; END $$;
    REVOKE ALL ON FUNCTION app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,text) FROM PUBLIC,anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,text) TO authenticated;
    CREATE FUNCTION app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,timestamptz,text) RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT app_private.update_staff_role_with_modules($1,$2,$3,$4,$5,$7) $$;
    CREATE FUNCTION public.update_staff_role_with_modules(uuid,text,text,text[],boolean,timestamptz,text) RETURNS void
      LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT app_private.update_staff_role_with_modules($1,$2,$3,$4,$5,$6,$7) $$;
    GRANT EXECUTE ON FUNCTION public.update_staff_role_with_modules(uuid,text,text,text[],boolean,timestamptz,text) TO authenticated;
    SELECT set_config('request.test.actor','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);`);
  const role = '11111111-1111-4111-8111-111111111111';
  const walletModule = '22222222-2222-4222-8222-222222222222';
  const kycModule = '33333333-3333-4333-8333-333333333333';
  const walletPermission = '44444444-4444-4444-8444-444444444444';
  const kycPermission = '55555555-5555-4555-8555-555555555555';
  await sql("INSERT INTO public.staff_roles(id,name,description,is_active) VALUES($1,'Wallet Approver','Old role description',true)", [role]);
  await sql("INSERT INTO public.staff_modules VALUES($1,'wallet'),($2,'kyc_review')", [walletModule, kycModule]);
  await sql("INSERT INTO public.staff_permissions VALUES($1,'admin.withdrawal.approve'),($2,'admin.kyc.review')", [walletPermission, kycPermission]);
  await sql('INSERT INTO public.staff_module_permissions VALUES($1,$2),($3,$4)', [walletModule, walletPermission, kycModule, kycPermission]);
  await sql('INSERT INTO public.staff_role_modules VALUES($1,$2)', [role, walletModule]);
  await sql('INSERT INTO public.staff_role_permissions VALUES($1,$2)', [role, walletPermission]);
  const wrapperHash = (await sql("SELECT md5(pg_get_functiondef('app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,timestamptz,text)'::regprocedure)) AS hash")).rows[0].hash;
  const grantsBefore = (await sql("SELECT has_function_privilege('authenticated','app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,text)','execute') AS auth, has_function_privilege('anon','app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,text)','execute') AS anon")).rows[0];
  await sql(await fs.readFile('supabase/migrations/20261024051428_staff_role_audit_snapshots.sql', 'utf8'));
  assert.equal((await sql("SELECT md5(pg_get_functiondef('app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,timestamptz,text)'::regprocedure)) AS hash")).rows[0].hash, wrapperHash);
  assert.deepEqual((await sql("SELECT has_function_privilege('authenticated','app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,text)','execute') AS auth, has_function_privilege('anon','app_private.update_staff_role_with_modules(uuid,text,text,text[],boolean,text)','execute') AS anon")).rows[0], grantsBefore);

  await sql("SELECT app_private.update_staff_role_with_modules($1,'Wallet Reviewer','New description',ARRAY['kyc_review'],false,'Reviewed role scope change')", [role]);
  const audit = (await sql("SELECT before_data,after_data FROM public.audit_logs WHERE entity_id=$1", [role])).rows[0];
  assert.deepEqual(audit.before_data, { roleName: 'Wallet Approver', moduleKeys: ['wallet'], permissionKeys: ['admin.withdrawal.approve'], isActive: true });
  assert.deepEqual(audit.after_data, { roleName: 'Wallet Reviewer', moduleKeys: ['kyc_review'], permissionKeys: ['admin.kyc.review'], isActive: false });
  assert.equal((await sql("SELECT name,is_active FROM public.staff_roles WHERE id=$1", [role])).rows[0].name, 'Wallet Reviewer');
  console.log('PASS role update retains wrapper/ACL and records complete permission snapshots with real before/after state');
} finally {
  await db?.end().catch(() => undefined);
  if (server) {
    server.kill('SIGINT'); const timer = setTimeout(() => server.kill('SIGKILL'), 2000);
    try { await closed; } finally { clearTimeout(timer); }
  }
  await fs.rm(root, { recursive: true, force: true });
  console.log('Disposable PostgreSQL stopped and removed');
}
