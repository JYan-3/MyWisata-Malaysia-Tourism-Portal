import { createServiceClient } from '@/lib/supabase/service';
import { guestPrivateResponse, hashGuestCredential, isSameOriginMutation, newGuestCredential, readGuestJson, setGuestCookie, reserveGuestRateLimit, guestAddressRateKey } from '@/lib/checkout/guest-session';
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return guestPrivateResponse(null,403);
  if (!await reserveGuestRateLimit(`access:${guestAddressRateKey(request)}`,30,900)) return guestPrivateResponse(null,429);
  const body = await readGuestJson(request) as { token?: unknown } | null;
  if (typeof body?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return guestPrivateResponse(null,404);
  const session = newGuestCredential();
  const { data, error } = await createServiceClient().rpc('exchange_guest_order_access', { p_token_hash: hashGuestCredential(body.token), p_session_hash: hashGuestCredential(session) });
  if (error || !data) return guestPrivateResponse(null,404);
  const response = guestPrivateResponse({ orderId: data });
  setGuestCookie(response,request,session,true);
  return response;
}
