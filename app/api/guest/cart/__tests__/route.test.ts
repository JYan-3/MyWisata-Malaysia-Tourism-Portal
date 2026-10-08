import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({guest:vi.fn(),limit:vi.fn(),from:vi.fn(),insert:vi.fn(),update:vi.fn(),upsert:vi.fn()}));
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({from:mocks.from})}));
vi.mock('@/lib/checkout/guest-session',async importOriginal=>({...await importOriginal<typeof import('@/lib/checkout/guest-session')>(),resolveGuestSession:mocks.guest,reserveGuestRateLimit:mocks.limit}));
vi.mock('@/backend/supabase',()=>({supabase:{}}));
import {POST,GET} from '../route';
const ID='1d4057cf-c821-4b05-a454-61dbdc42d32c';
const variant='2d4057cf-c821-4b05-a454-61dbdc42d32c';
function request(body:unknown,origin='https://mywisata.example'){return new Request('https://mywisata.example/api/guest/cart',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});}
beforeEach(()=>{
 vi.clearAllMocks();mocks.guest.mockResolvedValue({guestSubjectId:ID});mocks.limit.mockResolvedValue(true);
 mocks.from.mockImplementation((table:string)=>{
  const b:Record<string,unknown>={};for(const key of ['select','eq','is','gt'])b[key]=()=>b;
  b.upsert=mocks.upsert.mockResolvedValue({error:null});b.insert=mocks.insert.mockResolvedValue({error:null});b.update=mocks.update.mockReturnValue(b);
  b.maybeSingle=async()=>({data:table==='products'?{id:ID,outlet_id:ID,requires_booking:false,base_price:10}:table==='product_variants'?{id:variant,price_offset:2}:{id:ID},error:null});
  b.order=async()=>({data:[],error:null});return b;
 });
});
describe('guest cart server boundary',()=>{
 it('rejects cross-origin mutation before touching owner data',async()=>{expect((await POST(request({},'https://attacker.example'))).status).toBe(403);expect(mocks.from).not.toHaveBeenCalled();});
 it('does not write for a missing or expired subject',async()=>{mocks.guest.mockResolvedValue(null);expect((await POST(request({}))).status).toBe(401);expect(mocks.from).not.toHaveBeenCalled();});
 it('rejects presented owner IDs instead of assigning the cart to them',async()=>{expect((await POST(request({item:{activityId:ID,variantId:variant,qty:1},guestSubjectId:ID}))).status).toBe(422);expect(mocks.insert).not.toHaveBeenCalled();});
 it('ignores supplied prices and persists the canonical product plus variant price',async()=>{
  expect((await POST(request({item:{activityId:ID,variantId:variant,qty:1,priceOverride:0.01}}))).status).toBe(200);
  expect(mocks.upsert).toHaveBeenCalledWith({guest_subject_id:ID},expect.objectContaining({onConflict:'guest_subject_id'}));
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({cart_id:ID,unit_price:12}));
 });
 it('returns an empty private response without creating a subject for anonymous reads',async()=>{mocks.guest.mockResolvedValue(null);const response=await GET(new Request('https://mywisata.example/api/guest/cart'));expect(await response.json()).toEqual({data:{items:[]},error:null});expect(response.headers.get('cache-control')).toContain('no-store');expect(mocks.upsert).not.toHaveBeenCalled();});
});
