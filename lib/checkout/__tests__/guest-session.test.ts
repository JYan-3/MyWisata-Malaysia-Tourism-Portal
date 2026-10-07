import { describe,expect,it,vi } from 'vitest';
vi.mock('@/lib/supabase/service',()=>({createServiceClient:vi.fn()}));
import { newGuestCredential,hashGuestCredential,setGuestCookie,guestPrivateResponse,readGuestCookie,isSameOriginMutation,readGuestJson } from '../guest-session';
describe('private guest credentials',()=>{
 it('issues 256-bit opaque secrets and keeps them out of JSON',()=>{
  const token=newGuestCredential();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(hashGuestCredential(token)).toMatch(/^[a-f0-9]{64}$/);
  expect(newGuestCredential()).not.toBe(token);
  const request=new Request('https://mywisata.example/api/guest/session');const response=guestPrivateResponse({ready:true});setGuestCookie(response,request,token);
  const cookie=response.headers.get('set-cookie')!;
  expect(cookie).toContain('__Host-mywisata-guest=');expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=lax');expect(cookie).toContain('Path=/');expect(cookie).not.toContain('Domain=');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(readGuestCookie(new Request(request.url,{headers:{cookie:`__Host-mywisata-guest=${token}`}}))).toBe(token);
 });
 it('rejects same-site but different origin writes and malformed credentials',()=>{
  expect(isSameOriginMutation(new Request('https://app.example/api',{headers:{origin:'https://other.app.example'}}))).toBe(false);
  expect(isSameOriginMutation(new Request('https://app.example/api',{headers:{origin:'https://app.example','sec-fetch-site':'cross-site'}}))).toBe(false);
  expect(isSameOriginMutation(new Request('https://app.example/api',{headers:{origin:'https://app.example'}}))).toBe(true);
  expect(readGuestCookie(new Request('https://app.example',{headers:{cookie:'__Host-mywisata-guest=email@example.com'}}))).toBeNull();
 });
 it('bounds body consumption and handles invalid JSON',async()=>{
  expect(await readGuestJson(new Request('https://app.example',{method:'POST',body:JSON.stringify({email:'a@example.com'})}))).toEqual({email:'a@example.com'});
  expect(await readGuestJson(new Request('https://app.example',{method:'POST',body:'x'.repeat(32769)}))).toBeNull();
  expect(await readGuestJson(new Request('https://app.example',{method:'POST',body:'invalid'}))).toBeNull();
 });
});
