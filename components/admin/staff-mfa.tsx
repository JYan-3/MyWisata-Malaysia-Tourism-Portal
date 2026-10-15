"use client";

import { KycMfa } from '@/components/admin/kyc-mfa';

/** Compatibility entry for the existing staff security route. */
export function StaffMfa({ next, available = true, scope = 'staff' }: { next: string; available?: boolean; scope?: 'kyc' | 'staff' }) {
  return <KycMfa next={next} available={available} scope={scope} />;
}
