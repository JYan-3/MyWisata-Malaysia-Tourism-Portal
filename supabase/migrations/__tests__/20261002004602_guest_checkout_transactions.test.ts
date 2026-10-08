import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const sql=readFileSync(new URL('../20261002004602_guest_checkout_transactions.sql',import.meta.url),'utf8');
describe('shared checkout SQL cores',()=>{
 it('extracts current installed functions only after required patch guards',()=>{expect(sql).toContain('pg_get_function_arguments');expect(sql).toContain('checkout_patch_chain_preflight_required');expect(sql).toContain('finalize_patch_chain_preflight_required');expect(sql).toContain('event_patch_chain_preflight_required');});
 it('restricts guest wrappers and prevents wallet/claims/vouchers and success cancellation',()=>{expect(sql).toContain("p_payment_method IN (''wallet'',''wallet_split'')");expect(sql).toContain('p_claim_id IS NOT NULL');expect(sql).toContain("p_outcome NOT IN ('failed','cancelled','expired')");expect(sql).toContain('FROM PUBLIC,anon,authenticated');expect(sql).toContain("resolve_user_capability(p_user,'commerce.checkout')");});
});
it('scopes both inventory updates by outlet and freezes account phone only on the first attempt',()=>{
 expect(sql).toContain('WHERE variant_id = v_reservation[.]variant_id');
 expect(sql).toContain('outlet_id IS NOT DISTINCT FROM v_reservation.outlet_id');
 expect(sql).toContain('IF NOT existing_attempt THEN');
 expect(sql).toContain('p_outcome IS NULL');
});
