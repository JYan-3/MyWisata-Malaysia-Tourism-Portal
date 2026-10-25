import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {withOwnedFlowDb} from './owned-flow-db.mjs';
await withOwnedFlowDb(async({db})=>{
  await db.query(`CREATE TABLE users(id uuid PRIMARY KEY,full_name text);
    CREATE TABLE withdrawal_requests(id uuid PRIMARY KEY,user_id uuid,status text,approval_cycle integer);
    CREATE TABLE withdrawal_approvals(id uuid,request_id uuid,approver_id uuid,action text,actioned_at timestamptz,approval_cycle int);
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,title text,body text,link text,category text,metadata jsonb,read_at timestamptz,event_key text);`);
  const original=await readFile('supabase/migrations/20261023134038_wallet_approver_alert_resolution.sql','utf8');
  await db.query(original.slice(original.indexOf('CREATE FUNCTION app_private.resolve_withdrawal_approver_notifications()'),original.indexOf('REVOKE ALL ON FUNCTION app_private.resolve_withdrawal_approver_notifications()')));
  await db.query('CREATE TRIGGER resolve_alert AFTER UPDATE ON withdrawal_requests FOR EACH ROW EXECUTE FUNCTION app_private.resolve_withdrawal_approver_notifications()');
  await db.query(await readFile('supabase/migrations/20261024211808_scope_staff_withdrawal_alert_resolution.sql','utf8'));
  for(const mode of ['complete','restart']) {
    const owner=randomUUID(),staff=randomUUID(),request=randomUUID();
    await db.query("INSERT INTO withdrawal_requests VALUES($1,$2,'pending',1)",[request,owner]);
    const metadata={withdrawal_id:request,approval_cycle:1};
    await db.query("INSERT INTO notifications(user_id,type,link,category,metadata) VALUES($1,'withdrawal_submitted','/customer/wallet','wallet',$3),($1,'withdrawal_submitted','/admin/withdrawals','wallet',$3),($2,'withdrawal_submitted','/admin/withdrawals','wallet',$3)",[owner,staff,metadata]);
    if(mode==='complete') await db.query("UPDATE withdrawal_requests SET status='approved' WHERE id=$1",[request]);
    else await db.query('UPDATE withdrawal_requests SET approval_cycle=2 WHERE id=$1',[request]);
    const rows=(await db.query("SELECT user_id,type,read_at FROM notifications WHERE metadata->>'withdrawal_id'=$1",[request])).rows;
    assert.equal(rows.filter(r=>r.user_id===owner && r.type==='withdrawal_submitted' && r.read_at===null).length,2,'customer-owned rows remain unchanged');
    assert.equal(rows.find(r=>r.user_id===staff).type,mode==='complete'?'withdrawal_approval_resolved':'withdrawal_approval_cycle_restarted');
  }
  console.log('PASS staff task resolution isolates matching customer notifications for completion and cycle restart');
});
