"use client";

import { StaffMfa } from '@/components/admin/staff-mfa';

/** KYC review entry to the shared staff authenticator flow. */
export function KycMfa({ next, available = true }: { next: string; available?: boolean }) {
  return <StaffMfa next={next} available={available} scope="kyc" />;
}
