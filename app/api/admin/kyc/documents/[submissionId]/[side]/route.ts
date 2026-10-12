import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail } from '@/lib/validation/schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ submissionId: string; side: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { user, response } = await requireStaffPermission('admin.kyc.review');
  if (response) return response;

  const { submissionId, side } = await params;
  if (!UUID.test(submissionId) || (side !== 'front' && side !== 'back')) {
    return apiFail('NOT_FOUND', 'Document not found', 404);
  }

  const service = createServiceClient();
  const { data: storagePath, error } = await service.rpc('get_kyc_document_view', {
    p_submission_id: submissionId,
    p_side: side,
    p_actor_id: user.id,
  });
  if (error) {
    if (error.message.includes('admin_required')) return apiFail('FORBIDDEN', 'Admin role required', 403);
    if (error.message.includes('document_not_found')) return apiFail('NOT_FOUND', 'Document not found', 404);
    return apiFail('DOCUMENT_UNAVAILABLE', 'Document is temporarily unavailable', 500);
  }
  if (typeof storagePath !== 'string') return apiFail('NOT_FOUND', 'Document not found', 404);

  const { data: document, error: downloadError } = await service.storage
    .from('kyc-documents')
    .download(storagePath);
  if (downloadError || !document) {
    return apiFail('DOCUMENT_UNAVAILABLE', 'Document is temporarily unavailable', 500);
  }
  const contentType = document.type;
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(contentType)) {
    return apiFail('DOCUMENT_UNAVAILABLE', 'Document is temporarily unavailable', 500);
  }
  return new Response(document, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `inline; filename="kyc-${side}"`,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
