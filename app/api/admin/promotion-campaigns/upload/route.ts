import crypto from 'node:crypto';
import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/service';

// Admin event-poster upload, reusing the event-posters bucket (20260928030000
// migration) under a campaigns/ prefix. Unlike the vendor-scoped upload route
// (app/api/vendors/[vendorId]/event-promotions/upload), admin isn't uploading
// under a vendor's own folder, so this goes through the service client rather
// than the bucket's vendor-ownership storage policy.
const BUCKET = 'event-posters';
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function safeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'poster';
}

export async function POST(request: Request) {
  const auth = await requireStaffPermission('admin.promotion_campaign.manage');
  if (auth.response) return auth.response;

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return apiFail('INVALID_FILE', 'Choose a poster image to upload.', 422);
  if (!IMAGE_TYPES.has(file.type)) return apiFail('INVALID_FILE_TYPE', 'Upload a JPG, PNG, or WebP image.', 422);
  if (file.size > MAX_BYTES) return apiFail('FILE_TOO_LARGE', 'Files must be 10 MB or smaller.', 422);

  const service = createServiceClient();
  const path = ['campaigns', crypto.randomUUID() + '-' + safeName(file.name)].join('/');
  const { error } = await service.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) return apiFail('UPLOAD_FAILED', error.message, 500);

  const { data: publicUrl } = service.storage.from(BUCKET).getPublicUrl(path);
  return apiOk({ url: publicUrl.publicUrl, path });
}
