import { redirect } from 'next/navigation';
import { StaffMfa } from '@/components/admin/staff-mfa';
import { createClient } from '@/lib/supabase/server';
import { safeAdminNext } from '@/lib/auth/safe-next';

export const dynamic = 'force-dynamic';

// Where the request proxy sends staff whose session has no authenticator code yet
// (lib/supabase/proxy.ts). It only manages the signed-in user's own factors.
export default async function StaffSecurityPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login?next=%2Fadmin');
  const params = await searchParams;
  return <StaffMfa next={safeAdminNext(params.next)} />;
}
