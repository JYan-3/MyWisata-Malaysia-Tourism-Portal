import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), insert: vi.fn(), clean: vi.fn(), external: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: () => ({ insert: mocks.insert }) }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/moderation/clean", () => ({ cleanUserContent: mocks.clean }));
vi.mock("@/lib/moderation", () => ({ moderateAccountText: mocks.external }));
vi.mock("@/lib/chatbot/classify-ai", () => ({ classifyTicketSmart: mocks.external }));
import { POST } from "../route";
import { redactPII } from "@/lib/chatbot/pii";
const request = (body: string) => new Request("http://localhost/api/account-suspended/appeal", { method: "POST", body: JSON.stringify({ body }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
  mocks.clean.mockImplementation(async (body: string) => ({ display: redactPII(body).clean }));
  mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "ticket-1" }, error: null }) }) });
});
describe("private suspension appeals", () => {
  it("rejects unauthenticated and short inputs before processing", async () => {
    expect((await POST(request("short"))).status).toBe(422);
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request("Please review my account"))).status).toBe(401);
    expect(mocks.clean).not.toHaveBeenCalled();
  });
  it("cleans and locally classifies a private ticket without external AI", async () => {
    const response = await POST(request("Please review my identity 900101-14-5678 and email me@example.test"));
    expect(response.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      body: "Please review my identity [IC] and email [EMAIL]", session_id: null,
      classification_method: "keyword", category: "kyc", user_id: "customer-1",
    }));
    expect(mocks.external).not.toHaveBeenCalled();
  });
  it("fails safely before storage if local cleaning is unavailable", async () => {
    mocks.clean.mockRejectedValue(new Error("private original evidence"));
    const response = await POST(request("Please review my account"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private original");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("bounds JSON before local processing", async () => {
    expect((await POST(request("a".repeat(17000)))).status).toBe(413);
    expect(mocks.clean).not.toHaveBeenCalled();
  });
});
