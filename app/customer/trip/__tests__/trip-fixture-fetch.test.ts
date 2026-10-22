import {describe,expect,it,vi} from "vitest";
import type {APIRequestContext} from "@playwright/test";
vi.mock("../../../../tests/e2e/helpers/demo",()=>({localEnv:()=>"test-only",signIn:vi.fn()}));
const {fixtureFetch}=await import("../../../../tests/e2e/helpers/trip-fixture");
const response=()=>({status:()=>200,text:async()=>"{}",headers:()=>({})});
describe("safe Trip fixture transport",()=>{
 it("retries an idempotent network read once",async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(new Error("Authorization: secret")).mockResolvedValue(response());
  const read=fixtureFetch({fetch} as unknown as APIRequestContext);
  expect((await read("https://example.test/rest/v1/trips")).status).toBe(200);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("never repeats account creation after an ambiguous timeout or logs headers",async()=>{
  const fetch=vi.fn().mockRejectedValue(new Error("Authorization: secret"));
  await expect(fixtureFetch({fetch} as unknown as APIRequestContext)("https://example.test/auth/v1/admin/users",{method:"POST"})).rejects.toThrow(/^Trip fixture network request failed$/);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("keeps the final failure after exactly two safe attempts",async()=>{
  const fetch=vi.fn().mockRejectedValue(new Error("Authorization: secret"));
  await expect(fixtureFetch({fetch} as unknown as APIRequestContext)("https://example.test/rest/v1/trips")).rejects.toThrow(/^Trip fixture network request failed$/);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("supports empty successful delete responses",async()=>{
  const fetch=vi.fn().mockResolvedValue({status:()=>204,headers:()=>({})});
  expect((await fixtureFetch({fetch} as unknown as APIRequestContext)("https://example.test/auth/v1/admin/users/owned",{method:"DELETE"})).status).toBe(204);
 });
});
