import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// Disposable local PostgreSQL only. Never accepts application or remote DB URLs.
const runtime = path.resolve(process.argv[2] ?? '/tmp/mywisata-commerce-pg-runtime');
const { default: EmbeddedPostgres } = await import(pathToFileURL(path.join(runtime,'node_modules/embedded-postgres/dist/index.js')).href);
const listener = net.createServer();
await new Promise(resolve => listener.listen(0,'127.0.0.1',resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const dir = await fs.mkdtemp(path.join(os.tmpdir(),'mylawatan-review-db-'));
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: randomUUID(), port, persistent: false, onLog: () => {}, onError: () => {} });
const clients=[];
async function connect() { const c=pg.getPgClient('postgres','127.0.0.1'); await c.connect(); clients.push(c); return c; }
const actor=randomUUID();
try {
  await pg.initialise(); await pg.start();
  const db=await connect();
  await db.query(`
    CREATE SCHEMA auth; CREATE SCHEMA app_private;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA auth,app_private,public TO authenticated,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    CREATE FUNCTION public.has_staff_permission(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.permitted',true)='true' $$;
    CREATE FUNCTION public.can_review_recommendation(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT public.has_staff_permission($1,'admin.recommendation.review') $$;
    CREATE FUNCTION public.is_super_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION app_private.require_kyc_operations_reviewer() RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT public.has_staff_permission(auth.uid(),'admin.kyc.review') THEN RAISE EXCEPTION 'forbidden'; END IF; END; $$;
    CREATE FUNCTION app_private.is_kyc_review_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE vendors(id uuid PRIMARY KEY,name text);
    CREATE TABLE outlets(id uuid PRIMARY KEY, vendor_id uuid,name text,display_id text,city text,state text,status text,
      address text,phone text,hotel_about text,amenity_codes text[],check_in_time text,check_out_time text,stay_policies jsonb,
      review_status text,review_note text,reviewed_by uuid,reviewed_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE products(id uuid PRIMARY KEY,vendor_id uuid,outlet_id uuid,name text,display_id text,product_type text,base_price numeric,status text,
      review_status text,review_note text,reviewed_by uuid,reviewed_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE vouchers(id uuid PRIMARY KEY,vendor_id uuid,outlet_id uuid,name text,code text,discount_value numeric,voucher_type text,
      review_status text,vendor_review_status text,review_note text,reviewed_by uuid,reviewed_at timestamptz,is_active boolean,created_at timestamptz DEFAULT now());
    CREATE TABLE hotel_profile_submissions(id uuid PRIMARY KEY,vendor_id uuid,outlet_id uuid,status text,payload jsonb,review_note text,
      reviewed_by uuid,reviewed_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE FUNCTION app_private.apply_hotel_profile_submission(uuid,uuid,timestamptz) RETURNS void LANGUAGE sql AS $$ UPDATE hotel_profile_submissions SET status='approved' WHERE id=$1 $$;
    CREATE TABLE content_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,vendor_id uuid,reviewer_id uuid,action text,note text);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,action text,entity_type text,entity_id uuid,before_data jsonb,after_data jsonb,note text);
    CREATE TABLE promotion_campaigns(id uuid PRIMARY KEY,title text);
    CREATE TABLE promotion_campaign_locations(id uuid PRIMARY KEY,name text);
    CREATE TABLE promotion_campaign_vendors(id uuid PRIMARY KEY,campaign_id uuid,vendor_id uuid,event_location_id uuid,stall_number text,requested_stall_number text,status text,created_at timestamptz DEFAULT now());
    CREATE TABLE vendor_event_promotions(id uuid PRIMARY KEY,vendor_id uuid,title text,starts_on date,ends_on date,status text,created_at timestamptz DEFAULT now());
    CREATE TABLE payments(id uuid PRIMARY KEY,provider text);
    CREATE TABLE orders(id uuid PRIMARY KEY,display_id text);
    CREATE TABLE refunds(id uuid PRIMARY KEY,payment_id uuid,order_id uuid,amount numeric,reason text,status text,created_at timestamptz DEFAULT now());
    CREATE TABLE kyc_submissions(id uuid PRIMARY KEY,user_id uuid,assigned_to uuid,claimed_at timestamptz,review_version integer,status text);
    CREATE TABLE vendor_recommendations(id uuid PRIMARY KEY,assigned_to uuid,claimed_at timestamptz,status text);
  `);
  await db.query(await fs.readFile(new URL('../../supabase/migrations/20261023141512_approver_state_consistency.sql',import.meta.url),'utf8'));
  const product=randomUUID();
  await db.query(`INSERT INTO products(id,review_status,status) VALUES($1,'pending_review','inactive')`,[product]);
  const version=(await db.query('SELECT updated_at::text AS v FROM products WHERE id=$1',[product])).rows[0].v;
  const a=await connect(),b=await connect();
  for(const c of [a,b]) {
    await c.query(`SELECT set_config('test.actor',$1,false),set_config('test.permitted','true',false)`,[actor]);
    await c.query('SET ROLE authenticated');
  }
  const decide=(c,action,v=version)=>c.query('SELECT review_catalogue_item($1,$2,$3,$4,$5)', ['product',product,v,action,'A complete review explanation']);
  const race=await Promise.allSettled([decide(a,'approve'),decide(b,'reject')]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(race.filter(r=>r.status==='rejected').length,1);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM content_reviews')).rows[0].n),1);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM audit_logs')).rows[0].n),1);
  await db.query(`UPDATE products SET review_status='pending_review',name='Resubmitted' WHERE id=$1`,[product]);
  await assert.rejects(decide(a,'approve'),/catalogue_item_changed/);
  const fresh=(await db.query('SELECT updated_at::text AS v FROM products WHERE id=$1',[product])).rows[0].v;
  await a.query("SELECT set_config('test.permitted','false',false)");
  await assert.rejects(decide(a,'approve',fresh),/permission_required/);
  await a.query("SELECT set_config('test.permitted','true',false)");
  await db.query(`CREATE FUNCTION app_private.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_audit_failure'; END $$;
    CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION app_private.fail_audit();`);
  await assert.rejects(decide(a,'approve',fresh),/injected_audit_failure/);
  assert.equal((await db.query('SELECT review_status FROM products WHERE id=$1',[product])).rows[0].review_status,'pending_review');
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM content_reviews')).rows[0].n),1);
  await db.query('DROP TRIGGER fail_audit ON audit_logs');
  await db.query(`INSERT INTO vendor_event_promotions(id,title,status,created_at) SELECT gen_random_uuid(),'Literal 100% fair','pending',now()+i*interval '1 second' FROM generate_series(1,61) i`);
  const page=(await db.query(`SELECT list_staff_review_queue('promotions',999,25,'pending','100%') AS q`)).rows[0].q;
  assert.equal(page.total,61); assert.equal(page.page,3); assert.equal(page.items.length,11); assert.equal(page.counts.pending,61);
  assert.equal((await db.query(`SELECT list_staff_review_queue('promotions',1,10,'pending','no-match') AS q`)).rows[0].q.total,0);
  await assert.rejects(a.query(`SELECT list_staff_review_queue('promotions',1,10,NULL,'')`),/permission denied/);
  const submission=randomUUID();
  await db.query(`INSERT INTO kyc_submissions VALUES($1,$2,NULL,NULL,7,'pending')`,[submission,randomUUID()]);
  const assignment=(await a.query(`SELECT read_staff_review_assignment('kyc',$1) AS a`,[submission])).rows[0].a;
  assert.equal(assignment.canDecide,false); assert.equal(assignment.reviewVersion,7);
  assert.equal((await db.query('SELECT assigned_to FROM kyc_submissions WHERE id=$1',[submission])).rows[0].assigned_to,null);
  const catalogue=(await db.query(`SELECT list_catalogue_review_queue(1,10,NULL) AS q`)).rows[0].q;
  assert.equal(catalogue.total,1); assert.equal(catalogue.items.length,1);
  await assert.rejects(a.query(`SELECT review_catalogue_item(NULL,$1,$2,'approve',NULL)`,[product,fresh]),/invalid_entity_type/);
  await assert.rejects(db.query(`SELECT list_catalogue_review_queue(1,NULL,NULL)`),/invalid_pagination/);
  await db.query(`ALTER TABLE vendor_event_promotions ADD reviewer_id uuid,ADD reviewed_at timestamptz,
    ADD rejection_reason text,ADD changes_requested_at timestamptz,ADD changes_requested_reason text,ADD updated_at timestamptz;
    CREATE TABLE vendor_event_promotion_review_events(promotion_id uuid,from_status text,to_status text,action text,actor_id uuid,actor_role text,note text);`);
  const promotion=(await db.query('SELECT id FROM vendor_event_promotions LIMIT 1')).rows[0].id;
  await a.query(`SELECT app_private.review_vendor_event_promotion($1,'reject','A valid review reason')`,[promotion]);
  assert.equal((await db.query('SELECT status FROM vendor_event_promotions WHERE id=$1',[promotion])).rows[0].status,'rejected');
  await a.query("SELECT set_config('test.permitted','false',false)");
  await assert.rejects(a.query(`SELECT app_private.set_vendor_event_promotion_visibility($1,'pause')`,[promotion]),/admin_required/);
  console.log('PASS real PostgreSQL: simultaneous decisions, atomic audit rollback, stale version, permission revocation, bounded literal search/page clamp, service-only queue ACL, read-only assignment, catalogue queue');
} finally {
  await Promise.allSettled(clients.map(c=>c.end()));
  await pg.stop().catch(()=>{});
  await fs.rm(dir,{recursive:true,force:true});
}
