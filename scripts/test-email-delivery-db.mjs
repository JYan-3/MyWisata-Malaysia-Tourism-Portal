#!/usr/bin/env node
/** Real concurrent SQL verification on a disposable loopback database; never sends mail. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
const host = process.env.EMAIL_TEST_PGHOST ?? '127.0.0.1';
if (!['127.0.0.1','::1','localhost'].includes(host) || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) throw new Error('loopback_database_required');
const config = { host, port: Number(process.env.EMAIL_TEST_PGPORT ?? 55439), user: process.env.EMAIL_TEST_PGUSER ?? 'postgres', password: 'email-test-only', database: 'postgres' };
const name = `mywisata_email_test_${Date.now()}_${process.pid}`;
const admin = new pg.Client(config); await admin.connect();
const db = new pg.Client({ ...config, database: name });
let other;
const superId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id1 = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const call = async (fn, values = [], client = db) => (await client.query(`select public.${fn}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`, values)).rows[0].result;
const insert = async (id = id1) => db.query("insert into public.email_outbox(id,event_key,to_email,event_type,payload) values($1::uuid,($1::uuid)::text,'synthetic@example.test','checkout_succeeded','{\"guestAccessToken\":\"synthetic-token\"}')",[id]);
const reset = () => db.query('truncate public.email_outbox');
const setService = client => client.query("select set_config('request.jwt.claim.role','service_role',false)");
const read = async id => (await db.query('select to_jsonb(e) as row from public.email_outbox e where id=$1',[id])).rows[0].row;
try {
  for (const role of ['anon','authenticated','service_role']) await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
  await admin.query(`create database ${name}`); await db.connect();
  await db.query(`create schema auth; create schema app_private;
    create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
    create table public.users(id uuid primary key);
    insert into public.users values('${superId}');
    create function public.is_super_admin(uid uuid) returns boolean language sql as $$ select uid='${superId}'::uuid $$;
    create table public.audit_logs(actor_id uuid,action text,entity_type text,entity_id uuid,after_data jsonb,note text);`);
  await db.query(readFileSync('supabase/legacy-migrations/048_email_outbox.sql','utf8'));
  await db.query(readFileSync('supabase/migrations/20261014114005_email_delivery_recovery.sql','utf8'));
  await setService(db);
  await assert.rejects(call('claim_email_outbox',[1]),/email_delivery_protocol_required/);
  await db.query('set role authenticated');
  await assert.rejects(call('inspect_email_outbox_delivery'),/permission denied/);
  await db.query('reset role');
  console.log('PASS legacy protocol fails closed and authenticated role cannot inspect');

  await insert(); await insert(id2);
  other = new pg.Client({ ...config, database: name }); await other.connect(); await setService(other);
  const claims = await Promise.all([call('claim_email_outbox_delivery',[1]),call('claim_email_outbox_delivery',[1],other)]);
  assert.equal(claims[0].rows.length,1); assert.equal(claims[1].rows.length,1);
  assert.notEqual(claims[0].rows[0].id,claims[1].rows[0].id);
  console.log('PASS two workers claim distinct messages');

  await reset(); await insert();
  const first = (await call('claim_email_outbox_delivery',[1])).rows[0];
  await db.query("update public.email_outbox set lease_expires_at=now()-interval '1 second' where id=$1",[id1]);
  const replacement = (await call('claim_email_outbox_delivery',[1])).rows[0];
  assert.notEqual(first.lease_token,replacement.lease_token);
  assert.equal(await call('begin_email_outbox_delivery',[id1,first.lease_token]),false);
  assert.equal(await call('begin_email_outbox_delivery',[id1,replacement.lease_token]),true);
  await db.query("update public.email_outbox set lease_expires_at=now()-interval '1 second' where id=$1",[id1]);
  const quarantined = await call('claim_email_outbox_delivery',[1]);
  assert.equal(quarantined.rows.length,0); assert.equal(quarantined.reviewRequired,1);
  assert.equal((await read(id1)).delivery_state,'unknown');
  assert.equal(await call('finish_email_outbox_delivery',[id1,replacement.lease_token,'sent','<verified@example.test>']),true);
  assert.equal(await call('finish_email_outbox_delivery',[id1,replacement.lease_token,'sent','<verified@example.test>']),true);
  assert.equal(await call('finish_email_outbox_delivery',[id1,replacement.lease_token,'retry',null]),false);
  const sent = await read(id1); assert.equal(sent.status,'sent'); assert.equal(sent.payload.guestAccessToken,undefined);
  console.log('PASS pre-send crash recovers; in-flight crash quarantines; late acceptance and lost ACK are idempotent');

  await reset(); await insert();
  await db.query("update public.email_outbox set status='sending',updated_at=now()-interval '16 minutes' where id=$1",[id1]);
  assert.equal((await call('claim_email_outbox_delivery',[1])).rows.length,0);
  let uncertain = await read(id1); assert.equal(uncertain.delivery_state,'unknown');
  await assert.rejects(call('resolve_email_outbox_delivery',[id1,null,uncertain.updated_at,id2,'retry','Confirmed synthetic delivery did not reach SMTP.',null]),/super_admin_required/);
  await assert.rejects(call('resolve_email_outbox_delivery',[id1,null,uncertain.updated_at,superId,'retry','short',null]),/delivery_evidence_required/);
  assert.equal(await call('resolve_email_outbox_delivery',[id1,null,uncertain.updated_at,superId,'retry','Verified the synthetic attempt never reached SMTP; authorize retry.',null]),true);
  await assert.rejects(call('resolve_email_outbox_delivery',[id1,null,uncertain.updated_at,superId,'retry','Stale second operator cannot authorize another retry.',null]),/email_delivery_changed/);
  let retried = (await call('claim_email_outbox_delivery',[1])).rows[0]; assert.ok(retried);
  assert.equal(await call('begin_email_outbox_delivery',[id1,retried.lease_token]),true);
  assert.equal(await call('finish_email_outbox_delivery',[id1,retried.lease_token,'unknown',null]),true);
  uncertain = await read(id1);
  assert.equal(await call('resolve_email_outbox_delivery',[id1,retried.lease_token,uncertain.updated_at,superId,'delivered','Verified synthetic SMTP sent copy and matching recipient inbox.', '<verified@example.test>']),true);
  assert.equal(await call('finish_email_outbox_delivery',[id1,retried.lease_token,'retry',null]),false);
  assert.equal((await db.query('select count(*)::integer as n from public.audit_logs')).rows[0].n,2);
  console.log('PASS legacy ambiguity, evidence/actor/version guards and audited recovery');

  await reset(); await insert();
  retried=(await call('claim_email_outbox_delivery',[1])).rows[0];
  await call('begin_email_outbox_delivery',[id1,retried.lease_token]);
  await db.query("update public.email_outbox set status='failed',lease_expires_at=now()-interval '1 second' where id=$1",[id1]);
  assert.equal((await call('claim_email_outbox_delivery',[1])).reviewRequired,1);
  assert.equal((await read(id1)).delivery_state,'unknown');
  console.log('PASS legacy security monitor cannot accidentally requeue in-flight mail');

  await reset(); await insert();
  await db.query("update public.email_outbox set status='sending',attempts=1,updated_at=now()-interval '16 minutes' where id=$1",[id1]);
  // Reproduce the old KYC monitor acting first, refreshing updated_at and status.
  await db.query("update public.email_outbox set status='failed',last_error='security_delivery_interrupted',updated_at=now() where id=$1",[id1]);
  const legacyReset = await call('claim_email_outbox_delivery',[1]);
  assert.equal(legacyReset.rows.length,0); assert.equal(legacyReset.reviewRequired,1);
  assert.equal((await read(id1)).delivery_state,'unknown');
  console.log('PASS monitor-first legacy NULL-token reset remains quarantined');
} finally {
  if (other) await other.end(); await db.end().catch(()=>{});
  await admin.query(`drop database if exists ${name} with(force)`); await admin.end();
}
