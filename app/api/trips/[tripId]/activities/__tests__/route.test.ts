import {beforeEach,describe,expect,it,vi} from "vitest";
const {search}=vi.hoisted(()=>({search:vi.fn()}));
vi.mock("@/app/customer/trip/actions",()=>({searchTripActivitiesAction:search}));
const {GET}=await import("../route");
const request=(query="")=>new Request("http://localhost/api/trips/owned/activities"+query);
const context={params:Promise.resolve({tripId:"owned"})};
beforeEach(()=>{vi.resetAllMocks();search.mockResolvedValue([{id:"saved",variants:[{id:"v"}]}]);});
describe("private Trip discovery read",()=>{
 it("reuses owner-scoped discovery and returns uncached data",async()=>{
  const res=await GET(request("?lat=3.14&lng=101.69"),context);
  expect(search).toHaveBeenCalledWith("owned",{lat:3.14,lng:101.69});
  expect(await res.json()).toMatchObject({data:[{id:"saved",variants:[{id:"v"}]}]});
  expect(res.headers.get("cache-control")).toContain("no-store");
 });
 it.each(["?lat=91&lng=101","?lat=3","?lat=wat&lng=101"])("rejects invalid coordinates %s",async query=>{
  expect((await GET(request(query),context)).status).toBe(422);expect(search).not.toHaveBeenCalled();
 });
 it.each([["Authentication required",401],["Trip not found",404],["private database detail",503]])("does not expose %s",async(message,status)=>{
  search.mockRejectedValue(new Error(message as string));const res=await GET(request(),context);
  expect(res.status).toBe(status);expect(await res.text()).not.toContain(message);
 });
});
