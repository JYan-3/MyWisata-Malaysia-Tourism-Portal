import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { hashGuestCredential, readGuestCookie, resolveGuestSession, isSameOriginMutation } from './guest-session';

/** Exact order authorization only. Email and URL IDs never confer access. */
export async function authorizeOrder(request: Request, orderId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return null;
  const account = await createClient();
  const { data: { user }, error } = await account.auth.getUser();
  if (user) {
    const { data } = await account.from('orders').select('id,user_id,guest_subject_id,status,total_amount,contact_email,contact_name,contact_phone').eq('id', orderId).eq('user_id', user.id).maybeSingle();
    return data ? { db: account, order: data, userId: user.id, guestSubjectId: null } : null;
  }
  if (error && error.name !== 'AuthSessionMissingError') return null;
  if (request.method !== 'GET' && !isSameOriginMutation(request)) return null;
  const service = createServiceClient();
  const guest = await resolveGuestSession(request);
  if (guest) {
    const { data } = await service.from('orders').select('id,user_id,guest_subject_id,status,total_amount,contact_email,contact_name,contact_phone').eq('id', orderId).eq('guest_subject_id', guest.guestSubjectId).is('user_id', null).maybeSingle();
    if (data) return { db: service, order: data, userId: null, guestSubjectId: guest.guestSubjectId };
  }
  const token = readGuestCookie(request, true);
  if (!token) return null;
  const { data: access } = await service.from('guest_order_access_sessions').select('order_id').eq('token_hash', hashGuestCredential(token)).eq('order_id', orderId).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!access) return null;
  const { data } = await service.from('orders').select('id,user_id,guest_subject_id,status,total_amount,contact_email,contact_name,contact_phone').eq('id', orderId).is('user_id', null).maybeSingle();
  return data?.guest_subject_id ? { db: service, order: data, userId: null, guestSubjectId: data.guest_subject_id as string } : null;
}
export async function authorizeCheckoutSession(request: Request, sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const account = await createClient();
  const { data: { user }, error } = await account.auth.getUser();
  if (!user && (error && error.name !== 'AuthSessionMissingError' || !readGuestCookie(request) && !readGuestCookie(request,true))) return null;
  const db = user ? account : createServiceClient();
  let query = db.from('checkout_sessions').select('id,order_id,user_id,guest_subject_id,status,currency,expires_at,payment_method').eq('id', sessionId);
  if (user) query = query.eq('user_id',user.id);
  const { data: session } = await query.maybeSingle();
  if (!session) return null;
  const access = await authorizeOrder(request, session.order_id);
  return access && session.user_id === access.order.user_id && session.guest_subject_id === access.order.guest_subject_id ? { ...access, session } : null;
}
