import { describe,expect,it,vi } from 'vitest';
vi.mock('@/lib/supabase/service',()=>({createServiceClient:vi.fn()}));
import { newGuestCredential,hashGuestCredential,setGuestCookie,guestPrivateResponse,readGuestCookie,isSameOriginMutation,readGuestJson,guestAddressRateKey } from '../guest-session';
describe('private guest credentials',()=>{
 it('trusts only the explicitly configured proxy and validates its final address',()=>{
  const originalVercel=process.env.VERCEL; const originalProxy=process.env.GUEST_TRUSTED_PROXY;
  try {
   delete process.env.VERCEL; delete process.env.GUEST_TRUSTED_PROXY;
   const request=new Request('https://example.test',{headers:{'x-forwarded-for':'198.51.100.1, 203.0.113.2','x-real-ip':'192.0.2.3'}});
   expect(guestAddressRateKey(request)).toBe('guest-address:unavailable');
   process.env.GUEST_TRUSTED_PROXY='hostinger-cdn';
   expect(guestAddressRateKey(request)).toBe('guest-address:203.0.113.2');
   expect(guestAddressRateKey(new Request(request.url,{headers:{'x-forwarded-for':'203.0.113.2, invalid'}}))).toBe('guest-address:unavailable');
   expect(guestAddressRateKey(new Request(request.url,{headers:{'x-real-ip':'203.0.113.2'}}))).toBe('guest-address:unavailable');
   process.env.VERCEL='1';
   expect(guestAddressRateKey(new Request(request.url,{headers:{'x-vercel-forwarded-for':'203.0.113.4, 198.51.100.5'}}))).toBe('guest-address:203.0.113.4');
  } finally {
   if(originalVercel===undefined) delete process.env.VERCEL; else process.env.VERCEL=originalVercel;
   if(originalProxy===undefined) delete process.env.GUEST_TRUSTED_PROXY; else process.env.GUEST_TRUSTED_PROXY=originalProxy;
  }
 });
 it('issues 256-bit opaque secrets and keeps them out of JSON',()=>{
  const token=newGuestCredential();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(hashGuestCredential(token)).toMatch(/^[a-f0-9]{64}$/);
  expect(newGuestCredential()).not.toBe(token);
  const request=new Request('https://mylawatan.example/api/guest/session');const response=guestPrivateResponse({ready:true});setGuestCookie(response,request,token);
  const cookie=response.headers.get('set-cookie')!;
  expect(cookie).toContain('__Host-mylawatan-guest=');expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=lax');expect(cookie).toContain('Path=/');expect(cookie).not.toContain('Domain=');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(readGuestCookie(new Request(request.url,{headers:{cookie:`__Host-mylawatan-guest=${token}`}}))).toBe(token);
  expect(readGuestCookie(new Request(request.url,{headers:{cookie:`__Host-mywisata-guest=${token}`}}))).toBe(token);
 });
 it('rejects same-site but different origin writes and malformed credentials',()=>{
  expect(isSameOriginMutation(new Request('https://app.example/api',{headers:{origin:'https://other.app.example'}}))).toBe(false);
  expect(isSameOriginMutation(new Request('https://app.example/api',{headers:{origin:'https://app.example','sec-fetch-site':'cross-site'}}))).toBe(false);
  expect(isSameOriginMutation(new Request('https://app.example/api',{headers:{origin:'https://app.example'}}))).toBe(true);
  expect(readGuestCookie(new Request('https://app.example',{headers:{cookie:'__Host-mywisata-guest=email@example.com'}}))).toBeNull();
 });
 it('falls back to a valid legacy cookie when the new cookie is malformed',()=>{
  const valid='a'.repeat(43);
  const request=new Request('https://app.example',{headers:{cookie:`__Host-mylawatan-guest=invalid; __Host-mywisata-guest=${valid}`}});
  expect(readGuestCookie(request)).toBe(valid);
 });
 it('bounds body consumption and handles invalid JSON',async()=>{
  expect(await readGuestJson(new Request('https://app.example',{method:'POST',body:JSON.stringify({email:'a@example.com'})}))).toEqual({email:'a@example.com'});
  expect(await readGuestJson(new Request('https://app.example',{method:'POST',body:'x'.repeat(32769)}))).toBeNull();
  expect(await readGuestJson(new Request('https://app.example',{method:'POST',body:'invalid'}))).toBeNull();
 });
});
