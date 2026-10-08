import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({rpc:mocks.rpc})}));
import {POST} from '../route';
const ID='1d4057cf-c821-4b05-a454-61dbdc42d32c';
function request(origin='https://app.example'){return new Request('https://app.example/api/guest/orders/access',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:'A'.repeat(43)})});}
beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockImplementation(async(name:string)=>({data:name==='reserve_guest_rate_limit'?true:ID,error:null}));});
describe('single-order access link exchange',()=>{
 it('sends only hashes to SQL and returns only order ID plus an HttpOnly cookie',async()=>{const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({data:{orderId:ID},error:null});expect(response.headers.get('set-cookie')).toContain('__Host-mywisata-order-access=');expect(response.headers.get('set-cookie')).toContain('HttpOnly');expect(mocks.rpc).toHaveBeenCalledWith('exchange_guest_order_access',{p_token_hash:expect.stringMatching(/^[a-f0-9]{64}$/),p_session_hash:expect.stringMatching(/^[a-f0-9]{64}$/)});});
 it('denies consumed/expired token and never sets a cookie',async()=>{mocks.rpc.mockImplementation(async(name:string)=>({data:name==='reserve_guest_rate_limit'?true:null,error:null}));const response=await POST(request());expect(response.status).toBe(404);expect(response.headers.get('set-cookie')).toBeNull();});
 it('rejects CSRF before token use',async()=>{expect((await POST(request('https://attacker.example'))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
});
