import {beforeEach,expect,it} from "vitest";
import {__resetRouteStateForTests,withRouteProviderSlot} from "../route-state";
beforeEach(__resetRouteStateForTests);
it("drops cancelled queued work and releases every provider slot",async()=>{
  const releases:Array<()=>void>=[];
  const active=Array.from({length:4},()=>withRouteProviderSlot(()=>new Promise<void>(resolve=>releases.push(resolve))));
  const controller=new AbortController();let ran=false;
  const queued=withRouteProviderSlot(async()=>{ran=true;return 1;},controller.signal);
  controller.abort();
  expect(await queued).toBeNull();expect(ran).toBe(false);
  releases.forEach(release=>release());await Promise.all(active);
  expect(await withRouteProviderSlot(async()=>2)).toBe(2);
});
it("keeps concurrency at four when new work arrives during queue handoff",async()=>{
  let active=0;let maximum=0;
  await Promise.all(Array.from({length:20},()=>withRouteProviderSlot(async()=>{active++;maximum=Math.max(maximum,active);await Promise.resolve();active--;return true;})));
  expect(maximum).toBe(4);
});
