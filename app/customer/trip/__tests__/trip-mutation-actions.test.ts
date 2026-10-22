import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({update:vi.fn(),revalidate:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({owned:true})}));
vi.mock("@/backend/domains/trips",()=>({createTrip:vi.fn(),deleteTrip:vi.fn(),getTripById:vi.fn(),getTripItems:vi.fn(),getTripNameSequence:vi.fn(),updateTripItem:mocks.update}));
vi.mock("@/backend/domains/catalogue",()=>({searchTripActivities:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("next/navigation",()=>({redirect:vi.fn()}));
const {updateTripItemScheduleAction}=await import("../actions");
beforeEach(()=>vi.resetAllMocks());
describe("Trip mutation transport",()=>{
 it("returns a safe validation failure rather than throwing into the framework",async()=>{
  mocks.update.mockRejectedValue(new Error("Trip times must follow itinerary order"));
  await expect(updateTripItemScheduleAction("trip","item",{scheduled_date:"2026-10-22",scheduled_time:"09:00"})).resolves.toEqual({ok:false});
  expect(mocks.revalidate).not.toHaveBeenCalled();
 });
 it("returns the canonical row and revalidates only after success",async()=>{
  const row={id:"stored",scheduled_time:"11:00:00"};mocks.update.mockResolvedValue(row);
  expect(await updateTripItemScheduleAction("trip","item",{scheduled_date:"2026-10-22",scheduled_time:"11:00"})).toEqual({ok:true,value:row});
  expect(mocks.revalidate).toHaveBeenCalledWith("/customer/trip/trip");
 });
});
