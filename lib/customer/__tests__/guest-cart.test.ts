import {afterEach,describe,it,expect,vi} from 'vitest';
import {addGuestCartItem,getGuestCart} from '../guest-cart';
afterEach(()=>vi.unstubAllGlobals());
describe('guest cart transport',()=>{
 it('initializes HttpOnly server session before mutation and never stores a secret in JS',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:200})).mockResolvedValueOnce(new Response(JSON.stringify({data:{items:[]}}),{status:200}));vi.stubGlobal('fetch',fetch);
  expect(await addGuestCartItem({activityId:'p',variantId:'v',qty:1})).toEqual([]);
  expect(fetch.mock.calls[0][0]).toBe('/api/guest/session');expect(fetch.mock.calls[1][1].credentials).toBe('same-origin');expect(fetch.mock.calls[1][1].body).not.toContain('token');
 });
 it('does not create a subject on a read',async()=>{const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{items:[]}})));vi.stubGlobal('fetch',fetch);expect(await getGuestCart()).toEqual([]);expect(fetch).toHaveBeenCalledTimes(1);});
});
