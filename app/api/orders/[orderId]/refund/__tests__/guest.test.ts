import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({authorize:vi.fn(),rpc:vi.fn(),from:vi.fn(),notify:vi.fn()}));
vi.mock('@/lib/checkout/order-access',()=>({authorizeOrder:mocks.authorize}));
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({rpc:mocks.rpc,from:mocks.from})}));
vi.mock('@/lib/vendor-notifications/emit',()=>({emitVendorNotification:mocks.notify}));
import {POST} from '../route';
const orderId='11111111-1111-4111-8111-111111111111';
const guestId='22222222-2222-4222-8222-222222222222';
const userId='33333333-3333-4333-8333-333333333333';
const request=()=>new Request('https://app.example/api/orders/'+orderId+'/refund',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.example'},body:JSON.stringify({reason:'Please cancel this purchase'})});
const params={params:Promise.resolve({orderId})};
beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:{id:'refund-fixture',status:'pending'},error:null});mocks.from.mockReturnValue({select:()=>({eq:async()=>({data:[],error:null})})});mocks.notify.mockResolvedValue({});});
describe('refund requests retain the exact authorized buyer',()=>{
 it('sends an authorized Guest through the existing hardened transaction with the server-owned guest identity',async()=>{
  mocks.authorize.mockResolvedValue({order:{id:orderId,status:'paid'},userId:null,guestSubjectId:guestId});
  expect((await POST(request(),params)).status).toBe(201);
  expect(mocks.rpc).toHaveBeenCalledWith('guest_request_order_refund',{p_order_id:orderId,p_guest_subject_id:guestId,p_reason:'Please cancel this purchase'});
 });
 it('retains the account transaction and authorized account ID',async()=>{
  mocks.authorize.mockResolvedValue({order:{id:orderId,status:'completed'},userId,guestSubjectId:null});
  expect((await POST(request(),params)).status).toBe(201);
  expect(mocks.rpc).toHaveBeenCalledWith('request_order_refund',{p_order_id:orderId,p_user_id:userId,p_reason:'Please cancel this purchase'});
 });
 it('does not request any refund when order authorization fails',async()=>{
  mocks.authorize.mockResolvedValue(null);expect((await POST(request(),params)).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
