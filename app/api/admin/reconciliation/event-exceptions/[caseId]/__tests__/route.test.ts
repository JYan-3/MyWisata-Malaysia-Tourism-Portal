import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({user:vi.fn(),role:vi.fn(),write:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.user},rpc:m.role})}));
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({rpc:m.write})}));
import { POST } from '../route';
const context={params:Promise.resolve({caseId:'33333333-3333-4333-8333-333333333333'})};
const request=(extra={})=>new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'claim',version:1,dueAt:'2026-10-10T10:00:00+08:00',...extra})});
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({data:{user:{id:'server-actor'}}});m.role.mockResolvedValue({data:true,error:null});m.write.mockResolvedValue({data:{version:2},error:null});});
it('rejects ordinary Admin before service access',async()=>{m.role.mockResolvedValue({data:false,error:null});expect((await POST(request(),context)).status).toBe(403);expect(m.write).not.toHaveBeenCalled();});
it('never accepts an actor or amount supplied by the browser',async()=>{expect((await POST(request({actor:'attacker',amount:1}),context)).status).toBe(422);expect(m.write).not.toHaveBeenCalled();});
it('binds the actor to the authenticated user and preserves optimistic version',async()=>{expect((await POST(request(),context)).status).toBe(200);expect(m.write).toHaveBeenCalledWith('update_event_order_exception',expect.objectContaining({p_actor:'server-actor',p_version:1}));});
it('keeps conflicting or unrefunded cases open',async()=>{m.write.mockResolvedValue({data:null,error:{message:'event_exception_obligation_outstanding'}});expect((await POST(request({action:'resolve',note:'Marked by operator'}),context)).status).toBe(409);});

it('accepts explicit no-show only with a substantive note and server actor',async()=>{
 expect((await POST(request({action:'confirm_no_show',note:'Verified customer absence and contact attempts'}),context)).status).toBe(200);
 expect(m.write).toHaveBeenCalledWith('update_event_order_exception',expect.objectContaining({p_action:'confirm_no_show',p_actor:'server-actor'}));
 m.write.mockClear();
 expect((await POST(request({action:'confirm_no_show',note:'too short'}),context)).status).toBe(422);
 expect(m.write).not.toHaveBeenCalled();
});
