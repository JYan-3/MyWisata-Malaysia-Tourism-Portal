import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk, eventPromotionSettingsPatchSchema, parseBody } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import {
  getEventPromotionCostPerDaySen,
  getEventPromotionMaxConcurrent,
  setEventPromotionCostPerDaySen,
  setEventPromotionMaxConcurrent,
} from '@/lib/admin/event-promotions';

// GET is intentionally readable by any signed-in user, not just staff — a
// vendor needs this rate/cap to see a cost preview and availability before
// submitting/paying. Neither value is sensitive. Only PATCH is staff-gated.
export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const service = createServiceClient();
  const [costPerDaySen, maxConcurrent] = await Promise.all([
    getEventPromotionCostPerDaySen(service),
    getEventPromotionMaxConcurrent(service),
  ]);
  return apiOk({ costPerDaySen, maxConcurrent });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireStaffPermission('admin.event_promotion.review');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const parsed = await parseBody(request, eventPromotionSettingsPatchSchema);
  if (!parsed.ok) return parsed.response;

  const service = createServiceClient();
  if (parsed.data.costPerDaySen !== undefined) {
    await setEventPromotionCostPerDaySen(service, parsed.data.costPerDaySen, user.id);
  }
  if (parsed.data.maxConcurrent !== undefined) {
    await setEventPromotionMaxConcurrent(service, parsed.data.maxConcurrent, user.id);
  }
  return apiOk(parsed.data);
}
