import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { validateRecommendationImage } from '@/lib/recommendations/submission';
import { readBoundedFormData, RequestBodyError } from '@/lib/validation/request-body';
import { reserveGuestRateLimit } from '@/lib/checkout/guest-session';
import { withPortalWorkload, WorkloadUnavailableError } from '@/lib/operations/workload';
import sharp from 'sharp';
import { validateMagicBytes } from '@/lib/kyc/magic-bytes';

const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function GET(request: Request) {
  const imageId = new URL(request.url).searchParams.get('imageId') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) return apiFail('NOT_FOUND', 'Image not found', 404);
  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const service = createServiceClient({ signal: request.signal });
  const { data: image, error } = await service.from('recommendation_images').select('storage_path')
    .eq('id', imageId).eq('owner_id', user.id).eq('is_staged', false).eq('upload_completed', true).is('removed_at', null).maybeSingle();
  if (error || !image) return apiFail('NOT_FOUND', 'Image not found', 404);
  const { data, error: downloadError } = await service.storage.from('recommendation-images').download(image.storage_path);
  if (downloadError || !data || data.size > 5 * 1024 * 1024 || !extensions[data.type]) return apiFail('IMAGE_UNAVAILABLE', 'Image unavailable', 503);
  return new Response(data, { headers: {
    'Content-Type': data.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline',
  } });
}

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

  const bytes = await file.arrayBuffer();
  if (!await validateMagicBytes(bytes, file.type)) {
    return apiFail('IMAGE_INVALID', 'Choose a valid JPG, PNG or WebP image', 422);
  }
  try {
    const image = sharp(Buffer.from(bytes), { limitInputPixels: 20_000_000, animated: false }).timeout({ seconds: 5 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000) {
      return apiFail('IMAGE_INVALID', 'Image dimensions exceed the supported limit', 422);
    }
    // metadata() only reads headers. Pixel statistics force libvips to decode the image.
    await image.stats();
  } catch {
    return apiFail('IMAGE_INVALID', 'Image data is damaged or unsupported', 422);
  }

  const service = createServiceClient({ signal });
  const id = crypto.randomUUID();
  const { data: path, error: reserveError } = await service.rpc('reserve_staged_recommendation_image', {
    p_owner: ownerId, p_id: id, p_bytes: file.size, p_extension: extensions[file.type],
  });
  if (reserveError || typeof path !== 'string') return apiFail('IMAGE_CAPACITY', 'Temporary image capacity reached; reuse your uploaded photos or try again later', reserveError?.message?.includes('staged_image_limit') ? 429 : 503);
  const { error: uploadError } = await service.storage.from('recommendation-images').upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) return apiFail('UPLOAD_FAILED', 'Unable to upload image', 502);
  const { data: ready, error: rowError } = await service.rpc('complete_staged_recommendation_image', { p_id: id, p_owner: ownerId });
  // Retain the reservation on uncertain Storage/DB outcomes for safe TTL cleanup.
  if (rowError || ready !== true) return apiFail('UPLOAD_FAILED', 'Unable to prepare image', 502);
  return apiOk({ stagedImageId: id }, { status: 201 });
}
