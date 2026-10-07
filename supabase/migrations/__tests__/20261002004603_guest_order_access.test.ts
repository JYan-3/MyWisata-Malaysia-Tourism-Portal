import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync(new URL('../20261002004603_guest_order_access.sql',import.meta.url),'utf8');
describe('guest order access and durable receipt',()=>{
 it('consumes expiring tokens atomically into a single-order session',()=>{expect(sql).toContain('consumed_at IS NULL AND expires_at>now()');expect(sql).toContain('RETURNING order_id INTO v_order');expect(sql).toContain('VALUES(v_order,p_session_hash');});
 it('queues idempotent mail transactionally and retains account cancellation notifications',()=>{expect(sql).toContain('guest_order_confirmation AFTER INSERT OR UPDATE OF status');expect(sql).toContain('EXISTS(SELECT 1 FROM public.email_outbox WHERE event_key=p_event_key)');expect(sql).toContain('IF v_order.user_id IS NOT NULL THEN');expect(sql).toContain('guest-event-cancelled:');});
});
