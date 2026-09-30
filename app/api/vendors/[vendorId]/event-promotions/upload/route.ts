import crypto from 'node:crypto';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';

// Mirrors app/api/vendors/[vendorId]/media/upload/route.ts's validation shape,
// against the dedicated event-posters bucket (20260928030000 migration).
const BUCKET = 'event-posters';
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface Props { params: Promise<{ vendorId: string }> }

function safeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'poster';
}

export async function POST(request: Request, { params }: Props) {
  const { vendorId } = await params;
  const access = await authorizeVendor(vendorId, undefined, { allowEventVendor: true });
  if (!access.ok) return access.response;

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return apiFail('INVALID_FILE', 'Choose a poster image to upload.', 422);
  if (!IMAGE_TYPES.has(file.type)) return apiFail('INVALID_FILE_TYPE', 'Upload a JPG, PNG, or WebP image.', 422);
  if (file.size > MAX_BYTES) return apiFail('FILE_TOO_LARGE', 'Files must be 10 MB or smaller.', 422);

  const path = [vendorId, crypto.randomUUID() + '-' + safeName(file.name)].join('/');
  const { error } = await access.access.serviceDb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) return apiFail('UPLOAD_FAILED', error.message, 500);

  const { data: publicUrl } = access.access.serviceDb.storage.from(BUCKET).getPublicUrl(path);
  return apiOk({ url: publicUrl.publicUrl, path });
}
