import { z } from 'zod';
import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { listCampaignRegistrations } from '@/lib/admin/campaign-registrations';

const querySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'changes_requested']).optional(),
});

export async function GET(request: Request) {
  const { user, response } = await requireStaffPermission('admin.promotion_campaign.manage');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ status: url.searchParams.get('status') ?? undefined });
  const status = parsed.success ? parsed.data.status : undefined;

  const service = createServiceClient();
  const registrations = await listCampaignRegistrations(service, status);
  return apiOk({ registrations });
}
