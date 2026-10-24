import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { z } from 'zod';

const workSchema = z.array(z.object({ id: z.string().uuid(), storage_path: z.string().regex(/^[a-f0-9-]{36}\/staged\/[a-f0-9-]{36}\.(jpg|png|webp)$/i) })).max(50);

export async function purgeStagedRecommendationImages() {
  const db = createServiceClient();
  const { data, error } = await db.rpc('claim_staged_recommendation_cleanup');
  const parsed = workSchema.safeParse(data);
  if (error || !parsed.success) throw new Error('staged_cleanup_unavailable');
  if (!parsed.data.length) return { claimed: 0, purged: 0 };
  const removed = await db.storage.from('recommendation-images').remove(parsed.data.map((item) => item.storage_path));
  if (removed.error) throw new Error('staged_storage_unavailable');
  const finished = await db.rpc('finish_staged_recommendation_cleanup', { p_ids: parsed.data.map((item) => item.id) });
  if (finished.error || !Number.isInteger(finished.data)) throw new Error('staged_cleanup_unconfirmed');
  return { claimed: parsed.data.length, purged: Number(finished.data) };
}
