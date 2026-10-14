import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSuperAdmin } from '../admin-guard';

const claims = (value: { sub: string; aal: string }) => ({ getClaims: async () => ({ data: { claims: value }, error: null }) });
const verified = claims({ sub: 'actor', aal: 'aal2' });
const superAdminRoles = () => ({ select: () => ({ eq: async () => ({ data: [{ roles: { name: 'super_admin' } }], error: null }) }) });

describe('general administration guard', () => {
  it.each([
    [['approver'], false], [['admin'], false], [['customer'], false], [[], false],
    [['super_admin'], true], [['approver', 'super_admin'], true],
  ] as [string[], boolean][])('roles %j have authority %s', async (roles, allowed) => {
    const db = { auth: verified, from: () => ({ select: () => ({ eq: async () => ({ data: roles.map((name) => ({ roles: { name } })), error: null }) }) }) } as unknown as SupabaseClient;
    expect(await isSuperAdmin(db, 'actor')).toBe(allowed);
  });

  it('fails closed even if a failed role lookup carries partial data', async () => {
    const db = { auth: verified, from: () => ({ select: () => ({ eq: async () => ({ data: [{ roles: { name: 'super_admin' } }], error: { message: 'lookup failed' } }) }) }) } as unknown as SupabaseClient;
    expect(await isSuperAdmin(db, 'actor')).toBe(false);
  });

  it('denies a super admin whose own session has no authenticator code yet', async () => {
    const db = { auth: claims({ sub: 'actor', aal: 'aal1' }), from: superAdminRoles } as unknown as SupabaseClient;
    expect(await isSuperAdmin(db, 'actor')).toBe(false);
  });

  it('still answers role questions about another user', async () => {
    const db = { auth: claims({ sub: 'someone-else', aal: 'aal1' }), from: superAdminRoles } as unknown as SupabaseClient;
    expect(await isSuperAdmin(db, 'actor')).toBe(true);
  });

  it('fails closed when the session cannot be verified', async () => {
    const db = { auth: { getClaims: async () => ({ data: null, error: { message: 'bad token' } }) }, from: superAdminRoles } as unknown as SupabaseClient;
    expect(await isSuperAdmin(db, 'actor')).toBe(false);
  });
});
