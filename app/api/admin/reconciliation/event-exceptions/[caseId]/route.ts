import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk, databaseUuidSchema } from '@/lib/validation/schemas';

const schema = z.object({ action: z.enum(['claim', 'resolve', 'confirm_no_show']), version: z.number().int().positive(),
  dueAt: z.string().datetime({ offset: true }).optional(), note: z.string().trim().min(5).max(500).optional() }).strict().refine(value => value.action !== 'confirm_no_show' || (value.note?.length ?? 0) >= 20, { message: 'A verified no-show explanation of at least 20 characters is required', path: ['note'] });

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const { data: allowed, error: roleError } = await db.rpc('is_super_admin', { uid: user.id });
  if (roleError || !allowed) return apiFail('FORBIDDEN', 'Super Admin access required', 403);
  const { caseId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!databaseUuidSchema.safeParse(caseId).success || !parsed.success) return apiFail('VALIDATION_FAILED', 'Invalid case action', 422);
  const { data, error } = await createServiceClient().rpc('update_event_order_exception', {
    p_case: caseId, p_actor: user.id, p_version: parsed.data.version, p_action: parsed.data.action,
    p_due: parsed.data.dueAt ?? null, p_note: parsed.data.note ?? null,
  });
  if (error) return apiFail('CASE_CONFLICT', 'This case changed or its refund is not complete. Refresh and review it.', 409);
  return apiOk(data);
}
