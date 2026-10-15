import { redirect } from 'next/navigation';
import { staffMfaDestination } from '@/lib/auth/staff-route-boundaries';

export const dynamic = 'force-dynamic';

/** Keep the teammate's existing URL while using the shared standalone MFA flow. */
export default async function StaffSecurityPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  redirect(staffMfaDestination(params.next ?? "/admin/dashboard"));
}
