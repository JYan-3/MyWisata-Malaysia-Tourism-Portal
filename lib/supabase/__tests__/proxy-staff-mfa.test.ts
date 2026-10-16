import { describe, expect, it } from 'vitest';
import { adminAssuranceGate } from '../proxy';

const aal1 = { sub: 'staff-1', aal: 'aal1' };
const aal2 = { sub: 'staff-1', aal: 'aal2' };

describe('admin authenticator gate', () => {
  it('sends unverified sessions on admin pages to the authenticator page', () => {
    expect(adminAssuranceGate('/admin', aal1)).toBe('page');
    expect(adminAssuranceGate('/admin/withdrawals', aal1)).toBe('page');
  });

  it('refuses admin APIs, including the admin AI assistant, without the code', () => {
    expect(adminAssuranceGate('/api/admin/withdrawals/abc/approve', aal1)).toBe('api');
    expect(adminAssuranceGate('/api/admin-ai/ask', aal1)).toBe('api');
  });

  it('lets verified sessions through', () => {
    expect(adminAssuranceGate('/admin/withdrawals', aal2)).toBeNull();
    expect(adminAssuranceGate('/api/admin/withdrawals', aal2)).toBeNull();
  });

  it('keeps the setup pages reachable before the code is entered', () => {
    expect(adminAssuranceGate('/admin/security', aal1)).toBeNull();
    expect(adminAssuranceGate('/admin/kyc/mfa', aal1)).toBeNull();
  });

  it('leaves signed-out visitors and non-admin paths to their own handling', () => {
    expect(adminAssuranceGate('/admin', null)).toBeNull();
    expect(adminAssuranceGate('/api/admin/withdrawals', {})).toBeNull();
    expect(adminAssuranceGate('/customer', aal1)).toBeNull();
    expect(adminAssuranceGate('/api/vendor/settlements', aal1)).toBeNull();
    expect(adminAssuranceGate('/administrator', aal1)).toBeNull();
  });
});
