import { z } from 'zod';
import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk, databaseUuidSchema } from '@/lib/validation/schemas';
import { processQueuedEventRefunds } from '@/lib/refunds/process-queued-event-refunds';
import { createServiceClient } from '@/lib/supabase/service';

const schema=z.object({listingId:databaseUuidSchema,pickupDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 reason:z.string().trim().min(5).max(500),version:z.string().length(32).optional()}).strict();
export async function POST(request:Request){
 const auth=await requireStaffPermission('admin.promotion_campaign.manage');
 if(auth.response)return auth.response;
 const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return apiFail('VALIDATION_FAILED','Select an event listing, date and reason',422);
 const {data,error}=await auth.db.rpc('resolve_event_shortage',{p_listing:parsed.data.listingId,p_date:parsed.data.pickupDate,p_reason:parsed.data.reason,p_version:parsed.data.version??null});
 if(error)return apiFail('SHORTAGE_CONFLICT','The affected reservations changed. Refresh the preview.',409);
 if(parsed.data.version)await processQueuedEventRefunds(createServiceClient());
 return apiOk(data);
}
