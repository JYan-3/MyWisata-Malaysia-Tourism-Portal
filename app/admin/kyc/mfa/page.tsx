import { redirect } from 'next/navigation';
import { KycMfa } from '@/components/admin/kyc-mfa';
import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { safeKycReviewNext } from '@/lib/auth/safe-next';

export const dynamic = 'force-dynamic';

export default async function KycMfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { response } = await requireStaffPermission('admin.kyc.review');
  if (response?.status === 401) redirect('/login?next=%2Fadmin%2Fkyc');
  if (response?.status === 403) redirect('/admin');
  const params = await searchParams;
  return <KycMfa next={safeKycReviewNext(params.next)} available={!response} />;
}
