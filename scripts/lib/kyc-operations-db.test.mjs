import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeRoot = path.resolve(process.env.KYC_EMBEDDED_PG_RUNTIME ?? process.argv[2] ?? '/tmp/mywisata-kyc-pg-runtime');
if (runtimeRoot.startsWith('http:') || runtimeRoot.startsWith('https:')) throw new Error('Only a local embedded-postgres runtime path is accepted');
const { default: EmbeddedPostgres } = await import(pathToFileURL(path.join(runtimeRoot, 'node_modules/embedded-postgres/dist/index.js')).href);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migration = await fs.readFile(path.join(repo, 'supabase/migrations/20261015192354_kyc_prescreening_operations.sql'), 'utf8');
const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mywisata-kyc-pg-'));
const port = 55439;
const pg = new EmbeddedPostgres({ databaseDir: dbDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {}, onError: () => {} });
const clients = new Set();
const reviewer1 = '11111111-1111-4111-8111-111111111111';
const reviewer2 = '22222222-2222-4222-8222-222222222222';
const reviewer3 = '33333333-3333-4333-8333-333333333333';
const service = '44444444-4444-4444-8444-444444444444';

function ok(label, value = '') { console.log(`PASS ${label}${value ? `: ${value}` : ''}`); }
function fail(label, error) { console.error(`FAIL ${label}: ${error?.message ?? error}`); process.exitCode = 1; }
async function client(database = 'postgres') {
  const c = pg.getPgClient(database, '127.0.0.1');
  await c.connect();
  clients.add(c);
  return c;
}
async function closeClient(c) { clients.delete(c); await c.end(); }
async function sql(c, text, params = []) { return c.query(text, params); }
async function claims(c, { sub = service, role = 'service_role', aal = 'aal2', permitted = 'true', superAdmin = false } = {}) {
  await sql(c, `SELECT set_config('request.jwt.claims', $1, false), set_config('request.kyc.permitted', $2, false), set_config('request.kyc.super_admin', $3, false)`, [JSON.stringify({ sub, role, aal }), permitted, String(superAdmin)]);
  if (!['authenticated', 'service_role'].includes(role)) throw new Error(`unexpected test role ${role}`);
  await sql(c, `SET ROLE ${role}`);
}
function uuid() { return crypto.randomUUID(); }
function hmac() { return 'a'.repeat(64); }

const schema = String.raw`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE SCHEMA app_private;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA auth, app_private TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(auth.jwt()->>'role','') $$;
CREATE TABLE public.users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, full_name text, phone text, tier text NOT NULL DEFAULT 'profile_complete',
 kyc_status text NOT NULL DEFAULT 'unverified', status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.kyc_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id), document_type text NOT NULL DEFAULT 'national_id',
 document_url text, status text NOT NULL DEFAULT 'pending', reviewer_id uuid REFERENCES public.users(id), rejection_reason text, reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), queue_position integer, ic_hash text, ic_hash_version text NOT NULL DEFAULT 'hmac_sha256_v1', legacy_single_document boolean NOT NULL DEFAULT false,
 review_reason_code text, review_reason_detail text, evidence_retention_started_at timestamptz, ocr_consent_at timestamptz,
 legal_name_snapshot text, email_snapshot text, phone_snapshot text, identity_snapshot_captured_at timestamptz,
 assigned_to uuid REFERENCES public.users(id), claimed_at timestamptz,
 CONSTRAINT kyc_status_ck CHECK (status IN ('draft','pending','info_requested','approved','rejected','superseded'))
);
CREATE TABLE public.kyc_submission_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES public.kyc_submissions(id) ON DELETE CASCADE,
 side text NOT NULL CHECK (side IN ('front','back')), storage_path text NOT NULL UNIQUE,
 mime_type text NOT NULL DEFAULT 'image/jpeg', created_at timestamptz NOT NULL DEFAULT now(), purge_claimed_at timestamptz,
 UNIQUE (submission_id, side)
);
CREATE TABLE public.kyc_ocr_results (
 submission_id uuid PRIMARY KEY REFERENCES public.kyc_submissions(id) ON DELETE RESTRICT, status text NOT NULL,
 holder_name text, document_number_hmac text, document_number_last4 text, expiry_date date, confidence numeric,
 mismatch_fields text[] NOT NULL DEFAULT '{}', provider_model text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.kyc_review_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES public.kyc_submissions(id), user_id uuid NOT NULL REFERENCES public.users(id),
 from_status text NOT NULL, to_status text NOT NULL, action text NOT NULL, actor_id uuid REFERENCES public.users(id), actor_role text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES public.users(id), action text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
 before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION app_private.require_kyc_aal2() RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN IF coalesce(auth.jwt()->>'aal','') <> 'aal2' THEN RAISE EXCEPTION 'aal2_required'; END IF; END; $$;
CREATE OR REPLACE FUNCTION public.has_staff_permission(p_user uuid, p_permission text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(current_setting('request.kyc.permitted', true),'false')='true' AND p_user IS NOT NULL AND p_permission='admin.kyc.review' $$;
CREATE OR REPLACE FUNCTION app_private.is_kyc_review_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('request.kyc.super_admin', true)='true' $$;
CREATE OR REPLACE FUNCTION app_private.admin_review_kyc(p_submission_id uuid,p_user_id uuid,p_action text,p_reason_code text,p_reason_detail text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_status text;
BEGIN SELECT status INTO old_status FROM public.kyc_submissions WHERE id=p_submission_id FOR UPDATE;
 IF old_status IS NULL THEN RAISE EXCEPTION 'kyc_not_found'; END IF;
 UPDATE public.kyc_submissions SET status=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'info_requested' END,
  review_reason_code=p_reason_code, review_reason_detail=p_reason_detail, reviewed_at=now() WHERE id=p_submission_id;
 INSERT INTO public.kyc_review_events(submission_id,user_id,from_status,to_status,action,actor_id,actor_role)
  VALUES(p_submission_id,p_user_id,old_status,CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'info_requested' END,p_action,auth.uid(),'reviewer');
END; $$;
CREATE OR REPLACE FUNCTION public.admin_review_kyc(p_submission_id uuid,p_user_id uuid,p_action text,p_reason_code text,p_reason_detail text) RETURNS void
LANGUAGE sql SECURITY INVOKER AS $$ SELECT app_private.admin_review_kyc($1,$2,$3,$4,$5) $$;
CREATE OR REPLACE FUNCTION public.record_kyc_ocr_result(
 p_submission_id uuid,p_status text,p_holder_name text,p_document_number_hmac text,p_document_number_last4 text,
 p_expiry_date date,p_confidence numeric,p_mismatch_fields text[],p_provider_model text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 INSERT INTO public.kyc_ocr_results(submission_id,status,holder_name,document_number_hmac,document_number_last4,expiry_date,confidence,mismatch_fields,provider_model)
 VALUES($1,$2,NULLIF(btrim($3),''),$4,$5,$6,$7,coalesce($8,'{}'),$9)
 ON CONFLICT(submission_id) DO UPDATE SET status=excluded.status,holder_name=excluded.holder_name,document_number_hmac=excluded.document_number_hmac,
 document_number_last4=excluded.document_number_last4,expiry_date=excluded.expiry_date,confidence=excluded.confidence,mismatch_fields=excluded.mismatch_fields,provider_model=excluded.provider_model,processed_at=now();
END; $$;
`;

try {
  // npm install was intentionally run with lifecycle scripts disabled; recreate
  // the package's disposable dylib aliases under /tmp only.
  const nativeRoot = path.join(runtimeRoot, 'node_modules/@embedded-postgres/darwin-arm64/native');
  const aliases = JSON.parse(await fs.readFile(path.join(nativeRoot, 'pg-symlinks.json'), 'utf8'))
    .reduce((out, item) => { out[path.basename(item.target)] = path.basename(item.source); return out; }, {});
  for (const [alias, target] of Object.entries(aliases)) {
    try { await fs.symlink(target, path.join(nativeRoot, 'lib', alias)); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  await pg.initialise();
  await pg.start();
  const admin = await client();
  await sql(admin, schema);
  try {
    await sql(admin, migration);
    await sql(admin, await fs.readFile(path.join(repo, 'supabase/migrations/20261016124312_kyc_prescreening_failure_policy.sql'), 'utf8'));
    ok('migration applies to isolated PostgreSQL');
  } catch (e) {
    fail('migration applies to isolated PostgreSQL', e);
    throw e;
  }

  const uuids = [reviewer1, reviewer2, reviewer3, service];
  await sql(admin, `INSERT INTO public.users(id,email,full_name,kyc_status) SELECT x, x::text||'@example.test', 'Reviewer '||left(x::text,8), 'unverified' FROM unnest($1::uuid[]) AS t(x)`, [uuids]);
  await sql(admin, `INSERT INTO public.kyc_submissions(id,user_id,document_type,status,ic_hash,ic_hash_version,legal_name_snapshot,email_snapshot,created_at)
   SELECT gen_random_uuid(), $1, 'national_id', 'pending', repeat('a',64), 'hmac_sha256_v1', 'Person '||g, 'person'||g||'@example.test', now()-(g||' minutes')::interval
   FROM generate_series(1,10000) g`, [reviewer3]);
  ok('10,000 queue fixture inserted');

  const reviewer = await client();
  await claims(reviewer, { sub: reviewer1, role: 'authenticated', aal: 'aal2', permitted: 'true' });
  const q = await sql(reviewer, `SELECT public.get_kyc_review_queue(400,25,'pending','all','') AS data`);
  const data = q.rows[0].data;
  if (data.total !== 10000 || data.totalPages !== 400 || data.pageSize !== 25 || data.submissions.length !== 25) throw new Error(`unexpected queue payload ${JSON.stringify({ total:data.total, totalPages:data.totalPages, pageSize:data.pageSize, length:data.submissions.length })}`);
  ok('bounded queue pagination and filtered total', `total=${data.total}, pages=${data.totalPages}, pageSize=${data.pageSize}`);

  const denied = await client();
  await claims(denied, { sub: reviewer1, role: 'authenticated', aal: 'aal1', permitted: 'true' });
  try { await sql(denied, `SELECT public.get_kyc_review_queue(1,10,'all','all','')`); fail('AAL2 gate rejects aal1', 'call unexpectedly succeeded'); }
  catch (e) { ok('AAL2 gate rejects aal1', e.message); }
  await claims(denied, { sub: reviewer1, role: 'authenticated', aal: 'aal2', permitted: 'false' });
  try { await sql(denied, `SELECT public.get_kyc_review_queue(1,10,'all','all','')`); fail('permission gate rejects non-reviewer', 'call unexpectedly succeeded'); }
  catch (e) { ok('permission gate rejects non-reviewer', e.message); }
  try { await sql(denied, `SELECT count(*) FROM public.kyc_prescreening_jobs`); fail('authenticated role cannot read private job table', 'query unexpectedly succeeded'); }
  catch (e) { ok('authenticated role cannot read private job table', e.message); }

  const workerA = await client(); const workerB = await client();
  await claims(workerA, { sub: reviewer1, role: 'authenticated', aal: 'aal2', permitted: 'true' });
  await claims(workerB, { sub: reviewer2, role: 'authenticated', aal: 'aal2', permitted: 'true' });
  const [nextA, nextB] = await Promise.all([
    sql(workerA, `SELECT public.manage_kyc_review_work('next',NULL) AS data`),
    sql(workerB, `SELECT public.manage_kyc_review_work('next',NULL) AS data`),
  ]);
  const picked = [nextA.rows[0].data.submissionId, nextB.rows[0].data.submissionId];
  if (!picked[0] || !picked[1] || picked[0] === picked[1]) throw new Error(`concurrent next duplicated ${JSON.stringify(picked)}`);
  const assigned = await sql(admin, `SELECT count(*)::int AS count FROM public.kyc_submissions WHERE id=ANY($1::uuid[]) AND assigned_to IS NOT NULL`, [picked]);
  if (assigned.rows[0].count !== 2) throw new Error(`expected 2 assigned rows, got ${assigned.rows[0].count}`);
  ok('concurrent reviewer next-case claims are distinct', picked.join(', '));

  const staleId = picked[0];
  const staleVersion = nextA.rows[0].data.reviewVersion;
  await sql(admin, `UPDATE public.kyc_submissions SET assigned_to=$1 WHERE id=$2`, [reviewer3, staleId]);
  await claims(reviewer, { sub: reviewer1, role: 'authenticated', aal: 'aal2', permitted: 'true' });
  try {
    await sql(reviewer, `SELECT public.review_kyc_case($1,$2,$3,'approve',NULL,NULL)`, [staleId, (await sql(admin, `SELECT user_id FROM public.kyc_submissions WHERE id=$1`, [staleId])).rows[0].user_id, staleVersion]);
    fail('stale review version is fenced', 'call unexpectedly succeeded');
  } catch (e) { ok('stale review version is fenced', e.message); }

  // A reviewer can only pause the session instance that it started. Starting
  // again interrupts the old interval; a delayed browser pause must not close
  // the new interval.
  const sessionTarget = picked[1];
  const sessionVersion = nextB.rows[0].data.reviewVersion;
  const firstSession = (await sql(workerB, `SELECT public.manage_kyc_review_work('start',$1,$2,NULL) AS data`, [sessionTarget, sessionVersion])).rows[0].data.sessionId;
  const secondSession = (await sql(workerB, `SELECT public.manage_kyc_review_work('start',$1,$2,NULL) AS data`, [sessionTarget, sessionVersion])).rows[0].data.sessionId;
  if (!firstSession || !secondSession || firstSession === secondSession) throw new Error('start did not replace the prior session');
  await sql(workerB, `SELECT public.manage_kyc_review_work('pause',$1,$2,$3)`, [sessionTarget, sessionVersion, firstSession]);
  const sessionRows = await sql(admin, `SELECT id,ended_at,end_reason FROM public.kyc_review_work_sessions WHERE id=ANY($1::uuid[]) ORDER BY id`, [[firstSession, secondSession]]);
  const oldRow = sessionRows.rows.find((row) => row.id === firstSession);
  const newRow = sessionRows.rows.find((row) => row.id === secondSession);
  if (!oldRow?.ended_at || oldRow.end_reason !== 'interrupted' || newRow?.ended_at) throw new Error(`stale pause changed the wrong interval ${JSON.stringify(sessionRows.rows)}`);
  await sql(workerB, `SELECT public.manage_kyc_review_work('pause',$1,$2,$3)`, [sessionTarget, sessionVersion, secondSession]);
  ok('stale pause cannot close a newer review interval');

  const jobUser = uuid(); const jobSubmission = uuid();
  await sql(admin, `INSERT INTO public.users(id,email,full_name) VALUES($1,$2,'OCR Job User')`, [jobUser, `${jobUser}@example.test`]);
  await sql(admin, `INSERT INTO public.kyc_submissions(id,user_id,status,ic_hash,ic_hash_version,legal_name_snapshot,email_snapshot) VALUES($1,$2,'pending',$3,'hmac_sha256_v1','OCR Job User',$4)`, [jobSubmission, jobUser, hmac(), `${jobUser}@example.test`]);
  await sql(admin, `INSERT INTO public.kyc_submission_documents(submission_id,side,storage_path,mime_type) VALUES($1,'front',$2,'image/jpeg'),($1,'back',$3,'image/jpeg')`, [jobSubmission, `${jobSubmission}/front.jpg`, `${jobSubmission}/back.jpg`]);
  const svc = await client(); await claims(svc, { sub: service, role: 'service_role', aal: 'aal1', permitted: 'false' });
  const firstJob = (await sql(svc, `SELECT public.ensure_kyc_prescreening($1) AS id`, [jobSubmission])).rows[0].id;
  const secondJob = (await sql(svc, `SELECT public.ensure_kyc_prescreening($1) AS id`, [jobSubmission])).rows[0].id;
  if (firstJob !== secondJob) throw new Error(`ensure created duplicate jobs: ${firstJob} vs ${secondJob}`);
  const jobCount = await sql(admin, `SELECT count(*)::int AS count FROM public.kyc_prescreening_jobs WHERE submission_id=$1`, [jobSubmission]);
  if (jobCount.rows[0].count !== 1) throw new Error(`expected one deduplicated job, got ${jobCount.rows[0].count}`);
  ok('prescreening job is idempotent', String(firstJob));
  const claimed = (await sql(svc, `SELECT public.claim_kyc_prescreening_jobs(1,60,3,1) AS data`)).rows[0].data;
  if (!Array.isArray(claimed) || claimed.length !== 1) throw new Error(`unexpected claim ${JSON.stringify(claimed)}`);
  const token = claimed[0].leaseToken;
  const blocked = (await sql(svc, `SELECT public.claim_kyc_prescreening_jobs(1,60,3,1) AS data`)).rows[0].data;
  if (blocked.length !== 0) throw new Error(`max_running ignored ${JSON.stringify(blocked)}`);
  ok('worker max-running cap holds while lease is active');
  const wrong = (await sql(svc, `SELECT public.finish_kyc_prescreening_job($1,$2,$3::jsonb,60) AS ok`, [firstJob, uuid(), JSON.stringify({ status:'unavailable' })])).rows[0].ok;
  if (wrong !== false) throw new Error(`wrong token accepted: ${wrong}`);
  ok('stale prescreening lease token is rejected');
  try {
    await sql(svc, `SELECT public.finish_kyc_prescreening_job($1,$2,$3::jsonb,60) AS ok`, [firstJob, token, JSON.stringify({ status:'matched', documentNumberHmac:hmac(), mismatchFields:[] })]);
    ok('matched prescreen result accepted');
  } catch (e) {
    fail('matched prescreen result accepted', e);
    console.error('This is the expected signature/finish-path check; inspect record_kyc_ocr_result and outcome assignment.', e.message);
  }
  const jobState = await sql(admin, `SELECT status,outcome,last_error_code FROM public.kyc_prescreening_jobs WHERE id=$1`, [firstJob]);
  console.log(`JOB_STATE ${JSON.stringify(jobState.rows[0])}`);

  // Two service connections racing for two ready jobs must never receive the
  // same row. The advisory budget lock serializes the capacity calculation,
  // while SKIP LOCKED makes the handoff atomic.
  const raceIds = [];
  for (let i = 0; i < 2; i += 1) {
    const u = uuid(); const s = uuid(); raceIds.push(s);
    await sql(admin, `INSERT INTO public.users(id,email,full_name) VALUES($1,$2,$3)`, [u, `${u}@example.test`, `Race User ${i}`]);
    await sql(admin, `INSERT INTO public.kyc_submissions(id,user_id,status,ic_hash,ic_hash_version,legal_name_snapshot,email_snapshot) VALUES($1,$2,'pending',$3,'hmac_sha256_v1',$4,$5)`, [s, u, hmac(), `Race User ${i}`, `${u}@example.test`]);
    await sql(admin, `INSERT INTO public.kyc_submission_documents(submission_id,side,storage_path,mime_type) VALUES($1,'front',$2,'image/jpeg'),($1,'back',$3,'image/jpeg')`, [s, `${s}/front.jpg`, `${s}/back.jpg`]);
    await sql(svc, `SELECT public.ensure_kyc_prescreening($1)`, [s]);
  }
  const workerC = await client(); const workerD = await client();
  await claims(workerC, { sub: service, role: 'service_role', aal: 'aal1', permitted: 'false' });
  await claims(workerD, { sub: service, role: 'service_role', aal: 'aal1', permitted: 'false' });
  const [raceA, raceB] = await Promise.all([
    sql(workerC, `SELECT public.claim_kyc_prescreening_jobs(1,60,3,2) AS data`),
    sql(workerD, `SELECT public.claim_kyc_prescreening_jobs(1,60,3,2) AS data`),
  ]);
  const raceClaimed = [raceA.rows[0].data[0]?.id, raceB.rows[0].data[0]?.id];
  if (!raceClaimed[0] || !raceClaimed[1] || raceClaimed[0] === raceClaimed[1]) throw new Error(`concurrent worker claims duplicated ${JSON.stringify(raceClaimed)}`);
  ok('concurrent worker claims are distinct', raceClaimed.join(', '));

  // Replacing the evidence rows after a lease is issued changes the revision;
  // the old worker result must cancel without writing OCR output.
  const revisionUser = uuid(); const revisionSubmission = uuid();
  await sql(admin, `INSERT INTO public.users(id,email,full_name) VALUES($1,$2,'Revision User')`, [revisionUser, `${revisionUser}@example.test`]);
  await sql(admin, `INSERT INTO public.kyc_submissions(id,user_id,status,ic_hash,ic_hash_version,legal_name_snapshot,email_snapshot) VALUES($1,$2,'pending',$3,'hmac_sha256_v1','Revision User',$4)`, [revisionSubmission, revisionUser, hmac(), `${revisionUser}@example.test`]);
  await sql(admin, `INSERT INTO public.kyc_submission_documents(submission_id,side,storage_path,mime_type) VALUES($1,'front',$2,'image/jpeg'),($1,'back',$3,'image/jpeg')`, [revisionSubmission, `${revisionSubmission}/old-front.jpg`, `${revisionSubmission}/old-back.jpg`]);
  const revisionJob = (await sql(svc, `SELECT public.ensure_kyc_prescreening($1) AS id`, [revisionSubmission])).rows[0].id;
  const revisionClaim = (await sql(svc, `SELECT public.claim_kyc_prescreening_jobs(1,60,3,20) AS data`)).rows[0].data.find((row) => row.id === revisionJob);
  if (!revisionClaim) throw new Error('revision job was not claimed');
  await sql(admin, `DELETE FROM public.kyc_submission_documents WHERE submission_id=$1`, [revisionSubmission]);
  await sql(admin, `INSERT INTO public.kyc_submission_documents(submission_id,side,storage_path,mime_type) VALUES($1,'front',$2,'image/jpeg'),($1,'back',$3,'image/jpeg')`, [revisionSubmission, `${revisionSubmission}/new-front.jpg`, `${revisionSubmission}/new-back.jpg`]);
  const staleRevision = (await sql(svc, `SELECT public.finish_kyc_prescreening_job($1,$2,$3::jsonb,60) AS ok`, [revisionJob, revisionClaim.leaseToken, JSON.stringify({ status:'matched', documentNumberHmac:hmac(), mismatchFields:[] })])).rows[0].ok;
  const staleState = (await sql(admin, `SELECT status,last_error_code FROM public.kyc_prescreening_jobs WHERE id=$1`, [revisionJob])).rows[0];
  if (staleRevision !== false || staleState.status !== 'cancelled' || staleState.last_error_code !== 'case_closed') throw new Error(`stale revision was accepted ${JSON.stringify({ staleRevision, staleState })}`);
  ok('stale evidence revision is fenced and cancelled', JSON.stringify(staleState));

  const expiredUser = uuid(); const expiredSubmission = uuid();
  await sql(admin, `INSERT INTO public.users(id,email,full_name) VALUES($1,$2,'Expired Lease User')`, [expiredUser, `${expiredUser}@example.test`]);
  await sql(admin, `INSERT INTO public.kyc_submissions(id,user_id,status,ic_hash,ic_hash_version,legal_name_snapshot,email_snapshot) VALUES($1,$2,'pending',$3,'hmac_sha256_v1','Expired Lease User',$4)`, [expiredSubmission, expiredUser, hmac(), `${expiredUser}@example.test`]);
  await sql(admin, `INSERT INTO public.kyc_submission_documents(submission_id,side,storage_path,mime_type) VALUES($1,'front',$2,'image/jpeg'),($1,'back',$3,'image/jpeg')`, [expiredSubmission, `${expiredSubmission}/front.jpg`, `${expiredSubmission}/back.jpg`]);
  const expiredJob = (await sql(svc, `SELECT public.ensure_kyc_prescreening($1) AS id`, [expiredSubmission])).rows[0].id;
  const expiredClaim = (await sql(svc, `SELECT public.claim_kyc_prescreening_jobs(1,1,3,20) AS data`, [])).rows[0].data.find((row) => row.id === expiredJob);
  if (!expiredClaim) throw new Error('expired lease job was not claimed');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const expiredFinish = (await sql(svc, `SELECT public.finish_kyc_prescreening_job($1,$2,$3::jsonb,1) AS ok`, [expiredJob, expiredClaim.leaseToken, JSON.stringify({ status:'unavailable' })])).rows[0].ok;
  if (expiredFinish !== false) throw new Error(`expired lease was accepted: ${expiredFinish}`);
  const reclaimedExpired = (await sql(svc, `SELECT public.claim_kyc_prescreening_jobs(20,60,3,20) AS data`)).rows[0].data.find((row) => row.id === expiredJob);
  if (!reclaimedExpired || reclaimedExpired.leaseToken === expiredClaim.leaseToken) throw new Error('expired lease was not reclaimed with a new token');
  ok('expired worker lease is rejected and reclaimed');

  const terminalUser = uuid(); const terminalSubmission = uuid();
  await sql(admin, `INSERT INTO public.users(id,email,full_name) VALUES($1,$2,'Terminal OCR User')`, [terminalUser, `${terminalUser}@example.test`]);
  await sql(admin, `INSERT INTO public.kyc_submissions(id,user_id,status,ic_hash,ic_hash_version,legal_name_snapshot,email_snapshot) VALUES($1,$2,'pending',$3,'hmac_sha256_v1','Terminal OCR User',$4)`, [terminalSubmission, terminalUser, hmac(), `${terminalUser}@example.test`]);
  await sql(admin, `INSERT INTO public.kyc_submission_documents(submission_id,side,storage_path,mime_type) VALUES($1,'front',$2,'image/jpeg'),($1,'back',$3,'image/jpeg')`, [terminalSubmission, `${terminalSubmission}/front.jpg`, `${terminalSubmission}/back.jpg`]);
  const terminalJob = (await sql(svc, `SELECT public.ensure_kyc_prescreening($1) AS id`, [terminalSubmission])).rows[0].id;
  const terminalClaim = (await sql(svc, `SELECT public.claim_kyc_prescreening_jobs(20,60,1,20) AS data`, [])).rows[0].data.find((row) => row.id === terminalJob);
  if (!terminalClaim) throw new Error('terminal job was not claimed');
  const terminalFinish = (await sql(svc, `SELECT public.finish_kyc_prescreening_job($1,$2,$3::jsonb,1) AS ok`, [terminalJob, terminalClaim.leaseToken, JSON.stringify({ status:'unavailable' })])).rows[0].ok;
  const terminalState = (await sql(admin, `SELECT status,outcome,last_error_code,finished_at FROM public.kyc_prescreening_jobs WHERE id=$1`, [terminalJob])).rows[0];
  if (terminalFinish !== true || terminalState.status !== 'failed' || terminalState.outcome !== 'manual_review' || terminalState.last_error_code !== 'ocr_unavailable' || !terminalState.finished_at) throw new Error(`terminal retry was not finalized ${JSON.stringify({ terminalFinish, terminalState })}`);
  ok('max-attempt OCR failure reaches a terminal manual-review state');

  // Permanent evidence/config errors do not spend every remaining attempt.
  await sql(admin, `UPDATE public.kyc_prescreening_jobs SET status='processing',attempts=1,attempt_limit=3,lease_token=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1`, [terminalJob, token]);
  await sql(svc, `SELECT public.finish_kyc_prescreening_job($1,$2,$3::jsonb,60)`, [terminalJob, token, JSON.stringify({status:'unavailable',retryable:false,failureCode:'evidence_missing'})]);
  const permanent = (await sql(admin, `SELECT status,last_error_code FROM public.kyc_prescreening_jobs WHERE id=$1`, [terminalJob])).rows[0];
  if (permanent.status !== 'failed' || permanent.last_error_code !== 'evidence_missing') throw new Error('permanent failure was retried');
  await sql(admin, `UPDATE public.kyc_prescreening_jobs SET status='processing',attempts=2,attempt_limit=3,lease_token=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1`, [terminalJob, token]);
  await sql(svc, `SELECT public.finish_kyc_prescreening_job($1,$2,$3::jsonb,60)`, [terminalJob, token, JSON.stringify({status:'unavailable',retryable:true,failureCode:'network'})]);
  const retry = (await sql(admin, `SELECT status,extract(epoch from available_at-now()) AS delay FROM public.kyc_prescreening_jobs WHERE id=$1`, [terminalJob])).rows[0];
  if (retry.status !== 'queued' || Number(retry.delay) < 115 || Number(retry.delay) > 121) throw new Error('transient failure did not use bounded backoff');
  ok('permanent failures stop and transient failures back off without deciding the case');

  // Isolate a release/reclaim race from the large fixture. A non-super-admin
  // cannot release another reviewer, while a version-matched global reviewer
  // can; the old reviewer then cannot decide after the case is reclaimed.
  await sql(admin, `UPDATE public.kyc_submissions SET status='approved' WHERE status='pending'`);
  const releaseUser = uuid(); const releaseSubmission = uuid();
  await sql(admin, `INSERT INTO public.users(id,email,full_name) VALUES($1,$2,'Release User')`, [releaseUser, `${releaseUser}@example.test`]);
  await sql(admin, `INSERT INTO public.kyc_submissions(id,user_id,status,ic_hash,ic_hash_version,legal_name_snapshot,email_snapshot,created_at) VALUES($1,$2,'pending',$3,'hmac_sha256_v1','Release User',$4,now())`, [releaseSubmission, releaseUser, hmac(), `${releaseUser}@example.test`]);
  const claimedRelease = (await sql(reviewer, `SELECT public.manage_kyc_review_work('next',NULL) AS data`)).rows[0].data;
  if (claimedRelease.submissionId !== releaseSubmission) throw new Error(`dedicated release case was not claimed ${JSON.stringify(claimedRelease)}`);
  const releaseVersion = claimedRelease.reviewVersion;
  const reviewer3Client = await client();
  await claims(reviewer3Client, { sub: reviewer3, role: 'authenticated', aal: 'aal2', permitted: 'true', superAdmin: false });
  try {
    await sql(reviewer3Client, `SELECT public.manage_kyc_review_work('release',$1,$2,NULL)`, [releaseSubmission, releaseVersion]);
    fail('non-super-admin release is fenced', 'call unexpectedly succeeded');
  } catch (e) { ok('non-super-admin release is fenced', e.message); }
  await claims(reviewer3Client, { sub: reviewer3, role: 'authenticated', aal: 'aal2', permitted: 'true', superAdmin: true });
  await sql(reviewer3Client, `SELECT public.manage_kyc_review_work('release',$1,$2,NULL)`, [releaseSubmission, releaseVersion]);
  const afterRelease = (await sql(admin, `SELECT assigned_to,review_version FROM public.kyc_submissions WHERE id=$1`, [releaseSubmission])).rows[0];
  if (afterRelease.assigned_to !== null || Number(afterRelease.review_version) !== Number(releaseVersion) + 1) throw new Error(`release did not fence assignment ${JSON.stringify(afterRelease)}`);
  ok('version-matched super-admin release succeeds and increments review version');
  await claims(reviewer3Client, { sub: reviewer3, role: 'authenticated', aal: 'aal2', permitted: 'true', superAdmin: false });
  const reclaimed = (await sql(reviewer3Client, `SELECT public.manage_kyc_review_work('next',NULL) AS data`)).rows[0].data;
  if (reclaimed.submissionId !== releaseSubmission || Number(reclaimed.reviewVersion) !== Number(releaseVersion) + 2) throw new Error(`release case was not reclaimed ${JSON.stringify(reclaimed)}`);
  try {
    await sql(reviewer, `SELECT public.review_kyc_case($1,$2,$3,'approve',NULL,NULL)`, [releaseSubmission, releaseUser, releaseVersion]);
    fail('stale decision after release/reclaim is fenced', 'call unexpectedly succeeded');
  } catch (e) { ok('stale decision after release/reclaim is fenced', e.message); }
  await closeClient(reviewer3Client);
  await closeClient(workerC); await closeClient(workerD);
  await closeClient(reviewer); await closeClient(denied); await closeClient(workerA); await closeClient(workerB); await closeClient(svc); await closeClient(admin);
} catch (e) {
  if (!process.exitCode) process.exitCode = 1;
  console.error(e?.stack ?? e);
} finally {
  for (const c of clients) await c.end().catch(() => {});
  const verificationExitCode = process.exitCode;
  await pg.stop().catch(() => {});
  process.exitCode = verificationExitCode;
  await fs.rm(dbDir, { recursive: true, force: true }).catch(() => {});
}
