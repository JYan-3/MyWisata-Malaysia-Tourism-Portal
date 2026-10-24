import { purgeStagedRecommendationImages } from '@/lib/recommendations/staged-cleanup';
import { recordPortalDispatch } from '@/lib/operations/queue-health';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await recordPortalDispatch('recommendation_images', 'started');
    const result = await purgeStagedRecommendationImages();
    await recordPortalDispatch('recommendation_images', 'succeeded');
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }
  catch { return Response.json({ error: 'staged_cleanup_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
