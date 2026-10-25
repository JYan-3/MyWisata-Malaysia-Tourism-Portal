import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { resolveGuestCommissionReviewSchema } from '@/lib/validation/affiliate-schemas';
import { isSuperAdmin } from '@/lib/affiliate/admin-guard';
import { resolveGuestCommissionReview } from '@/lib/affiliate/clearing';

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  if (!(await isSuperAdmin(supabase, user.id))) {
    return apiFail('FORBIDDEN', 'Only Super Admin can review commissions', 403);
  }

  const parsed = await parseBody(request, resolveGuestCommissionReviewSchema);
  if (!parsed.ok) return parsed.response;

  const result = await resolveGuestCommissionReview(
    createServiceClient(), id, parsed.data.version, parsed.data.action, user.id,
  );
  if (result.outcome === 'error') return apiFail('DB_ERROR', result.error ?? 'Could not resolve this review', 500);
  if (result.outcome === 'stale') return apiFail('INVALID_STATE', 'This review was already changed. Refresh the list and try again.', 409);
  return apiOk({ id, status: result.decision, version: result.version });
}
