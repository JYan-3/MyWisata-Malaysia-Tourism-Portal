import { apiOk } from '@/lib/validation/schemas';
import { authorizeVendor } from '@/lib/vendor-authorization';
import { getMyAnnouncements } from '@/lib/vendor/announcements';

interface Props { params: Promise<{ vendorId: string }> }

// vendorId in the path is only used to establish that the caller is an
// authorized vendor user — announcements themselves are a global inbox
// (per-user read state), not scoped to one vendor.
export async function GET(_request: Request, { params }: Props) {
  const { vendorId } = await params;
  const access = await authorizeVendor(vendorId);
  if (!access.ok) return access.response;

  const announcements = await getMyAnnouncements(access.access.serviceDb, access.access.userId);
  return apiOk({ announcements });
}
