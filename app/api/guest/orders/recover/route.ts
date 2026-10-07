import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { guestPrivateResponse, guestAddressRateKey, hashGuestCredential, isSameOriginMutation, readGuestJson, reserveGuestRateLimit } from '@/lib/checkout/guest-session';
const schema=z.object({orderId:z.string().uuid(),email:z.string().trim().email().max(254)}).strict();
export async function POST(request:Request) {
  if (!isSameOriginMutation(request)) return guestPrivateResponse(null,403);
  const body=schema.safeParse(await readGuestJson(request));
  const response=()=>guestPrivateResponse({message:'If the details match a guest order, an access link will be emailed.'});
  if (!body.success) return response();
  if (!await reserveGuestRateLimit(`recovery:${guestAddressRateKey(request)}`,10,3600)) return response();
  if (!await reserveGuestRateLimit(`recovery-order:${body.data.orderId}`,3,3600)) return response();
  const service=createServiceClient();
  const {data}=await service.from('orders').select('id,contact_email').eq('id',body.data.orderId).is('user_id',null).not('guest_subject_id','is',null).maybeSingle();
  if (data && String(data.contact_email).toLowerCase()===body.data.email.toLowerCase()) {
    const window=Math.floor(Date.now()/3600000);
    await service.rpc('queue_guest_order_access',{p_order_id:data.id,p_event_key:`guest-recovery:${hashGuestCredential(`${data.id}:${window}`)}`,p_reason:'Your requested private order link.'});
  }
  return response();
}
