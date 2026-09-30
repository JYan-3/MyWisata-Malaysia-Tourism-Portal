import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { z } from 'zod';
import { processRefund } from '@/lib/refunds/process-refund';

const schema = z.object({ action: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional() }).strict();
interface Props { params: Promise<{ refundId: string }> }

export async function POST(request: Request, { params }: Props) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const { data: roles } = await db.from('user_roles').select('roles(name)').eq('user_id', user.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const names = (roles ?? []).map((row: any) => row.roles?.name);
  if (!names.includes('super_admin')) return apiFail('FORBIDDEN', 'Super Admin role required', 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiFail('VALIDATION_FAILED', 'action is required', 422);
  const service = createServiceClient();
  const { refundId } = await params;
  const { data: refund } = await service.from('refunds').select('id,status').eq('id', refundId).maybeSingle();
  if (!refund) return apiFail('NOT_FOUND', 'Refund request not found', 404);
  if (refund.status !== 'pending') return apiFail('INVALID_STATE', 'Refund is already processed', 409);
  if (parsed.data.action === 'reject') {
    const { error } = await service.from('refunds').update({ status: 'rejected', processed_by: user.id, processed_at: new Date().toISOString(), reason: parsed.data.note ?? null }).eq('id', refundId);
    if (error) return apiFail('DB_ERROR', error.message, 500);
    return apiOk({ refundId, status: 'rejected' });
  }
  const result = await processRefund({ service, walletDb: db, refundId, actorId: user.id, note: parsed.data.note ?? null });
  if (!result.ok) return apiFail(result.code, result.message, result.status);
  return apiOk(result.data);
}
