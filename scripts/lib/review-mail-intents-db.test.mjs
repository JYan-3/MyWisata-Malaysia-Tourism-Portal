import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { asRole, withOwnedFlowDb } from './owned-flow-db.mjs';

await withOwnedFlowDb(async ({ db, connect }) => {
  await db.query(`
    CREATE TABLE users(id uuid PRIMARY KEY,email text,full_name text,preferred_locale text);
    CREATE TABLE vendors(id uuid PRIMARY KEY,owner_id uuid,name text,status text);
    CREATE TABLE vendor_recommendations(id uuid PRIMARY KEY,vendor_name text);
    CREATE TABLE recommendation_review_events(id uuid PRIMARY KEY,recommendation_id uuid,recommender_id uuid,action text,to_status text,created_at timestamptz DEFAULT now());
    CREATE TABLE content_reviews(id uuid PRIMARY KEY,vendor_id uuid,entity_id uuid,entity_type text,action text,note text,created_at timestamptz DEFAULT now());
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,vendor_id uuid,outlet_id uuid,audience_role text,type text,title text,body text,link text,category text,metadata jsonb,event_key text);
    CREATE UNIQUE INDEX notifications_event_key ON notifications(event_key) WHERE event_key IS NOT NULL;
    CREATE TABLE email_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_key text UNIQUE,user_id uuid,to_email text,event_type text,payload jsonb DEFAULT '{}',status text DEFAULT 'pending',attempts integer DEFAULT 0,last_error text,next_attempt_at timestamptz DEFAULT now(),sent_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE audit_logs(actor_id uuid,action text,entity_type text,entity_id uuid,after_data jsonb,note text);
    CREATE FUNCTION public.is_super_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION app_private.portal_queue_health() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    GRANT EXECUTE ON FUNCTION app_private.portal_queue_health() TO service_role;
  `);
  await db.query(await readFile('supabase/migrations/20261014114005_email_delivery_recovery.sql', 'utf8'));
  const receiptMigration = await readFile('supabase/migrations/20261024041354_durable_order_receipts.sql', 'utf8');
  await db.query(receiptMigration.split('-- Preserve Guest access credentials')[0]);
  await db.query(await readFile('supabase/migrations/20261024205800_review_mail_intents_and_delivery_bounds.sql', 'utf8'));
  const owner = randomUUID(), vendor = randomUUID(), recommendation = randomUUID();
  await db.query("INSERT INTO users VALUES($1,'synthetic@example.test','Synthetic Owner','ms')", [owner]);
  await db.query("INSERT INTO vendors VALUES($1,$2,'Synthetic Vendor','approved')", [vendor, owner]);
  await db.query("INSERT INTO vendor_recommendations VALUES($1,'Synthetic Vendor')", [recommendation]);
  const insertRecommendationEvent = (id) => db.query("INSERT INTO recommendation_review_events(id,recommendation_id,recommender_id,action,to_status) VALUES($1,$2,$3,'approve','approved')", [id,recommendation,owner]);
  await insertRecommendationEvent(randomUUID());
  assert.equal((await db.query('SELECT count(*)::int n FROM email_outbox')).rows[0].n,1);
  await insertRecommendationEvent(randomUUID());
  assert.equal((await db.query('SELECT count(*)::int n FROM email_outbox')).rows[0].n,1,'same approval intent is idempotent');
  await db.query("INSERT INTO content_reviews VALUES($1,$2,$3,'product','submitted',null,now())", [randomUUID(),vendor,randomUUID()]);
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications')).rows[0].n,0,'submission events remain valid and do not generate decision notices');
  const review = randomUUID();
  await db.query("INSERT INTO content_reviews VALUES($1,$2,$3,'product','approved',null,now())", [review,vendor,randomUUID()]);
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications')).rows[0].n,1);
  const payload=(await db.query("SELECT payload FROM email_outbox WHERE event_key=$1", [`listing:review:${review}:${owner}`])).rows[0].payload;
  assert.equal(payload.locale,'ms');
  assert.equal(payload.vendorName,'Synthetic Vendor');
  assert.equal('internalNote' in payload,false);
  await db.query("ALTER TABLE email_outbox ADD CONSTRAINT injected_failure CHECK(event_type <> 'vendor_listing_review') NOT VALID");
  const failedReview=randomUUID();
  await assert.rejects(db.query("INSERT INTO content_reviews VALUES($1,$2,$3,'product','rejected','Synthetic reason',now())", [failedReview,vendor,randomUUID()]));
  assert.equal((await db.query('SELECT count(*)::int n FROM content_reviews WHERE id=$1',[failedReview])).rows[0].n,0,'failed intent rolls back review event');
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications')).rows[0].n,1,'failed intent rolls back notification');
  await db.query('ALTER TABLE email_outbox DROP CONSTRAINT injected_failure');
  await db.query("INSERT INTO email_outbox(event_key,event_type,to_email) SELECT 'synthetic:'||g,'recommendation_approved','synthetic@example.test' FROM generate_series(1,6) g");
  const a=await connect(),b=await connect();
  await asRole(a,'service_role'); await asRole(b,'service_role');
  await a.query('BEGIN');
  const first=(await a.query('SELECT public.claim_email_outbox_delivery_v2(20) data')).rows[0].data;
  assert.equal(first.rows.length,2);
  const waiting=b.query('SELECT public.claim_email_outbox_delivery(20) data');
  await a.query('COMMIT');
  assert.equal((await waiting).rows[0].data.rows.length,0,'other worker cannot exceed the shared ceiling');
  for(const row of first.rows) {
    assert.equal((await a.query('SELECT public.begin_email_outbox_delivery($1,$2) ok',[row.id,row.lease_token])).rows[0].ok,true);
    assert.equal((await a.query("SELECT public.finish_email_outbox_delivery($1,$2,'sent','synthetic-message') ok",[row.id,row.lease_token])).rows[0].ok,true);
  }
  const next=(await b.query('SELECT public.claim_email_outbox_delivery_v2(2) data')).rows[0].data;
  assert.equal(next.rows.length,2,'acknowledged sends release capacity');
  await db.query("UPDATE email_outbox SET status='sent',delivery_state='accepted',lease_expires_at=null WHERE status='sending'");
  await db.query("UPDATE email_outbox SET status='sending',delivery_state='in_flight',delivery_started_at=now()-interval '20 minutes',lease_expires_at=now()-interval '1 minute',lease_token=gen_random_uuid() WHERE id=(SELECT id FROM email_outbox WHERE status='pending' LIMIT 1)");
  const afterExpiry=(await b.query('SELECT public.claim_email_outbox_delivery_v2(2) data')).rows[0].data;
  assert.equal(afterExpiry.rows.length,1,'expired in-flight SMTP retains a slot until evidence resolves it');
  const health=(await a.query('SELECT public.portal_queue_health() data')).rows[0].data.email;
  assert.equal(health.reviewRequired,1); assert.equal(health.sending,1);
  for(const role of ['anon','authenticated']) {
    const denied=await connect(); await asRole(denied,role,randomUUID());
    await assert.rejects(denied.query('SELECT public.claim_email_outbox_delivery_v2(2)'),/permission denied/);
  }
  console.log('PASS review intent atomicity, recipient/locale, dedupe, rollback, two-session global claim ceiling, stale SMTP fencing, health and ACL');
});
