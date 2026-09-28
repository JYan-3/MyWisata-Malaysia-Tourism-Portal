import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk, parseBody, vendorAnnouncementCreateSchema } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { createVendorAnnouncement, listVendorAnnouncements } from '@/lib/admin/vendor-announcements';

export async function GET() {
  const { user, response } = await requireStaffPermission('admin.vendor_announcement.manage');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const announcements = await listVendorAnnouncements(createServiceClient());
  return apiOk({ announcements });
}

export async function POST(request: Request) {
  const { user, response } = await requireStaffPermission('admin.vendor_announcement.manage');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const parsed = await parseBody(request, vendorAnnouncementCreateSchema);
  if (!parsed.ok) return parsed.response;

  const announcement = await createVendorAnnouncement(createServiceClient(), {
    title: parsed.data.title,
    body: parsed.data.body,
    senderCode: parsed.data.senderCode,
    campaignId: parsed.data.campaignId ?? null,
  }, user.id);
  return apiOk({ announcement }, { status: 201 });
}
