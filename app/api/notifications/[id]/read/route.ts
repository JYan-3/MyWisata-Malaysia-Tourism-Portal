import { createClient } from '@/lib/supabase/server';
import { requireStaffNotificationAccess } from '@/lib/notifications/staff-access';
import { apiFail, apiOk } from '@/lib/validation/schemas';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const scope = new URL(request.url).searchParams.get('scope') ?? 'customer';
  if (scope !== 'customer' && scope !== 'staff') return apiFail('INVALID_SCOPE', 'Unknown notification scope', 400);
  if (scope === 'staff') {
    const staffResponse = await requireStaffNotificationAccess(db, user.id);
    if (staffResponse) return staffResponse;
  }
  const { error } = await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  if (error) return apiFail('DB_ERROR', error.message, 500);
  return apiOk({ id, read: true });
}
