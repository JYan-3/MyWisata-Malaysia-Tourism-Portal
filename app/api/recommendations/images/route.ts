import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { validateRecommendationImage } from '@/lib/recommendations/submission';
import { readBoundedFormData, RequestBodyError } from '@/lib/validation/request-body';
import { reserveGuestRateLimit } from '@/lib/checkout/guest-session';
import { withPortalWorkload, WorkloadUnavailableError } from '@/lib/operations/workload';

const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function POST(request: Request) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  if (!await reserveGuestRateLimit(`recommendation-upload:${user.id}`, 15, 600)) return apiFail('RATE_LIMITED', 'Too many upload attempts; please try again later', 429);
  try { return await withPortalWorkload('recommendation_upload', (signal) => uploadImage(request, user.id, signal), request.signal); }
  catch (error) {
    const response = apiFail('IMAGE_CAPACITY', 'Image processing is busy; please try again shortly', error instanceof WorkloadUnavailableError && error.code === 'busy' ? 429 : 503);
    response.headers.set('Retry-After', '10');
    return response;
  }
}

async function uploadImage(request: Request, ownerId: string, signal: AbortSignal) {
  let form: FormData;
  try { form = await readBoundedFormData(request, 5 * 1024 * 1024 + 64 * 1024, signal); }
  catch (error) { return apiFail('IMAGE_INVALID', 'Image upload exceeds the request limits', error instanceof RequestBodyError && error.code === 'too_large' ? 413 : 400); }
  const file = form?.get('image');
  if (!(file instanceof File)) return apiFail('IMAGE_REQUIRED', 'Choose an image to upload', 422);
  const message = validateRecommendationImage(file);
  if (message) return apiFail('IMAGE_INVALID', message, 422);

  const service = createServiceClient({ signal });
  const id = crypto.randomUUID();
  const { data: path, error: reserveError } = await service.rpc('reserve_staged_recommendation_image', {
    p_owner: ownerId, p_id: id, p_bytes: file.size, p_extension: extensions[file.type],
  });
  if (reserveError || typeof path !== 'string') return apiFail('IMAGE_CAPACITY', 'Temporary image capacity reached; reuse your uploaded photos or try again later', reserveError?.message?.includes('staged_image_limit') ? 429 : 503);
  const { error: uploadError } = await service.storage.from('recommendation-images').upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (uploadError) return apiFail('UPLOAD_FAILED', 'Unable to upload image', 502);
  const { data: ready, error: rowError } = await service.rpc('complete_staged_recommendation_image', { p_id: id, p_owner: ownerId });
  // Retain the reservation on uncertain Storage/DB outcomes for safe TTL cleanup.
  if (rowError || ready !== true) return apiFail('UPLOAD_FAILED', 'Unable to prepare image', 502);
  return apiOk({ stagedImageId: id }, { status: 201 });
}
