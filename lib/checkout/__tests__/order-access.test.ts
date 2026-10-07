import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),from:vi.fn(),serviceFrom:vi.fn(),resolveGuest:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.getUser},from:mocks.from})}));
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({from:mocks.serviceFrom})}));
vi.mock('../guest-session',async importOriginal=>({...await importOriginal<typeof import('../guest-session')>(),resolveGuestSession:mocks.resolveGuest}));
import {authorizeOrder} from '../order-access';
const ORDER='1d4057cf-c821-4b05-a454-61dbdc42d32c';
const queries:{table:string;filters:unknown[][]}[]=[];
function result(table:string,data:unknown) {const filters:unknown[][]=[];queries.push({table,filters});const b:Record<string,unknown>={};for(const name of ['select','eq','is','gt'])b[name]=vi.fn((...args:unknown[])=>{filters.push([name,...args]);return b;});b.maybeSingle=async()=>({data,error:null});return b;}
beforeEach(()=>{vi.clearAllMocks();queries.length=0;mocks.getUser.mockResolvedValue({data:{user:null},error:null});mocks.resolveGuest.mockResolvedValue({guestSubjectId:'guest-a'});});
describe('exact guest order authorization',()=>{
 it('never falls back to guest after account ownership denial',async()=>{
  mocks.getUser.mockResolvedValue({data:{user:{id:'account-a'}},error:null});mocks.from.mockImplementation(table=>result(table,null));
  expect(await authorizeOrder(new Request('https://app.example'),ORDER)).toBeNull();expect(mocks.resolveGuest).not.toHaveBeenCalled();expect(mocks.serviceFrom).not.toHaveBeenCalled();
 });
 it('scopes service reads to the validated subject and exact order',async()=>{
  mocks.serviceFrom.mockImplementation(table=>result(table,{id:ORDER,user_id:null,guest_subject_id:'guest-a'}));
  expect((await authorizeOrder(new Request('https://app.example'),ORDER))?.guestSubjectId).toBe('guest-a');
  expect(queries[0].filters).toContainEqual(['eq','id',ORDER]);expect(queries[0].filters).toContainEqual(['eq','guest_subject_id','guest-a']);expect(queries[0].filters).toContainEqual(['is','user_id',null]);
 });
 it('denies cross-guest, expired and cookie mutation CSRF',async()=>{
  mocks.serviceFrom.mockImplementation(table=>result(table,null));expect(await authorizeOrder(new Request('https://app.example'),ORDER)).toBeNull();
  mocks.resolveGuest.mockResolvedValue(null);expect(await authorizeOrder(new Request('https://app.example'),ORDER)).toBeNull();
  expect(await authorizeOrder(new Request('https://app.example',{method:'POST',headers:{origin:'https://attacker.example'}}),ORDER)).toBeNull();
 });
 it('does not infer ownership from order ID or a supplied email',async()=>{
  mocks.resolveGuest.mockResolvedValue(null);expect(await authorizeOrder(new Request('https://app.example?email=a@example.com'),ORDER)).toBeNull();expect(mocks.serviceFrom).not.toHaveBeenCalled();
 });
});
