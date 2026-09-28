import { createServiceClient } from '@/lib/supabase/service';
import { log } from '@/lib/log';
import { getRequestId } from '@/lib/request-id';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const service = createServiceClient();
    const { error } = await service.from('platform_settings').select('key').limit(1);
    if (error) {
      log('error', '[health] database check failed', { requestId, error: error.message });
      return Response.json({ status: 'unavailable', requestId, checks: { database: 'failed', cron: process.env.CRON_SECRET ? 'configured' : 'missing' } }, { status: 503 });
    }
    return Response.json({ status: 'ok', requestId, checks: { database: 'ok', cron: process.env.CRON_SECRET ? 'configured' : 'missing' } });
  } catch (error) {
    log('error', '[health] database check failed', { requestId, error: error instanceof Error ? error.message : String(error) });
    return Response.json({ status: 'unavailable', requestId, checks: { database: 'failed', cron: process.env.CRON_SECRET ? 'configured' : 'missing' } }, { status: 503 });
  }
}
