import { createClient } from '@/lib/supabase/server';
import { apiFail, apiOk, databaseUuidSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

/** GET ?registrationId=&date=YYYY-MM-DD — pickup times and stock left for one stall on one day. Public. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const registrationId = url.searchParams.get('registrationId') ?? '';
  const date = url.searchParams.get('date') ?? '';
  if (!databaseUuidSchema.safeParse(registrationId).success || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiFail('VALIDATION_FAILED', 'A stall and a date are required', 422);
  }

  const db = await createClient();
  const { data, error } = await db.rpc('get_event_pickup_availability', { p_registration_id: registrationId, p_pickup_date: date });
  if (error) {
    if (error.message.includes('not_found')) return apiFail('NOT_FOUND', 'This stall is not taking reservations', 404);
    return apiFail('DB_ERROR', 'Availability could not be loaded', 500);
  }
  return apiOk(data);
}
