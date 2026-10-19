import { createServiceClient } from '@/lib/supabase/service';
import { processKycPrescreening } from '@/lib/kyc/prescreening';

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await processKycPrescreening(createServiceClient());
    return Response.json(result, { status: result.writeErrors > 0 ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'kyc_prescreening_unavailable' }, { status: 503 });
  }
}
