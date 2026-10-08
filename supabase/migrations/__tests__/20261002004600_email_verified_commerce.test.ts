import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync(new URL('../20261002004600_email_verified_commerce.sql',import.meta.url),'utf8');
describe('Email-only commerce migration',()=>{
 it('publishes new immutable built-in policy versions and keeps top-up phone qualified',()=>{
  expect(sql).toContain("'draft','allow'");expect(sql).toContain("status='retired'");expect(sql).toContain("status='active'");expect(sql).toContain("IF p.key='builtin.wallet.top_up'");expect(sql).toContain("'phone_verified','eq','true'::jsonb");expect(sql).not.toContain('DELETE FROM public.entitlement_policy_requirements');
 });
 it('fails closed for custom active commerce policy requirements',()=>{expect(sql).toContain('custom_commerce_policy_preflight_required');expect(sql).toContain('commerce_policy_preflight_required');});
});
