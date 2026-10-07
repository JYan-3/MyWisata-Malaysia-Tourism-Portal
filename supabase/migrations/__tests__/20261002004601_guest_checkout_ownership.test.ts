import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync(new URL('../20261002004601_guest_checkout_ownership.sql',import.meta.url),'utf8');
describe('separate guest ownership schema',()=>{
 it('covers every commerce owner and protects credentials from browser roles',()=>{
  for(const table of ['carts','orders','checkout_sessions','bookings','ticket_passes','digital_entitlements'])expect(sql).toContain(`('${table}',`);
  expect(sql).toContain('num_nonnulls(%I,guest_subject_id)=1');expect(sql).toContain('ENABLE ROW LEVEL SECURITY');expect(sql).toContain('FROM PUBLIC, anon, authenticated');expect(sql).not.toMatch(/CREATE POLICY.+TO anon/);
 });
 it('binds child records with null-safe parent checks and atomic rate reservations',()=>{expect(sql).toContain('v_user IS DISTINCT FROM v_child_user');expect(sql).toContain('ON CONFLICT(key_hash) DO UPDATE');expect(sql).toContain('ticket_parent_owner');});
});
