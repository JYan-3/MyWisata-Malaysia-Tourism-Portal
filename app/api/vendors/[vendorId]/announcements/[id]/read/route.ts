import { apiFail, apiOk } from '@/lib/validation/schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { markAnnouncementRead } from '@/lib/vendor/announcements';

interface Props { params: Promise<{ vendorId: string; id: string }> }

export async function POST(_request: Request, { params }: Props) {
  const { vendorId, id } = await params;
  const access = await authorizeVendor(vendorId, undefined, { allowEventVendor: true });
  if (!access.ok) return access.response;

  const result = await markAnnouncementRead(access.access.authDb, id);
  if (!result.ok) {
    if (result.code === 'not_found') return apiFail('NOT_FOUND', 'Announcement not found', 404);
    return apiFail('DB_ERROR', 'Failed to mark the announcement read', 500);
  }
  return apiOk({ ok: true });
}
