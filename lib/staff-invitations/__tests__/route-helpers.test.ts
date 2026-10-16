import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ sendEmail: vi.fn() }));

vi.mock("@/lib/email/sender", () => ({ sendStaffInvitationEmail: mocks.sendEmail }));

import { deliverPreparedInvitation } from "@/lib/staff-invitations/route-helpers";

const prepared = {
  id: "22222222-2222-4222-8222-222222222222",
  invited_email: "staff@example.com",
  role_name: "KYC Reviewer",
  permission_keys: ["admin.kyc.review"],
  status: "pending" as const,
  delivery_status: "sending" as const,
  expires_at: "2026-10-20T04:30:00.000Z",
};

function database(preferredLocale: string | null, queryError: { message: string } | null = null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: preferredLocale === null ? null : { preferred_locale: preferredLocale }, error: queryError })),
  };
  return {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: vi.fn(() => query),
  };
}

describe("staff invitation email locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://mywisata.test";
    mocks.sendEmail.mockResolvedValue({ id: "message-1" });
  });

  it.each([["zh-CN"], ["ms"], ["en"]])("uses the recipient's saved %s preference", async (locale) => {
    const db = database(locale);

    await deliverPreparedInvitation(db as unknown as SupabaseClient, prepared, "secret-token", "a".repeat(64));

    expect(db.from).toHaveBeenCalledWith("users");
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ locale }));
  });

  it.each([
    [null, null],
    ["unsupported", null],
  ] as const)("falls back to English for missing or invalid preference", async (preferredLocale, queryError) => {
    const db = database(preferredLocale, queryError);

    await deliverPreparedInvitation(db as unknown as SupabaseClient, prepared, "secret-token", "a".repeat(64));

    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
  });
  it("does not send the wrong language when a saved preference cannot be read", async () => {
    const db = database("zh-CN", {message: "lookup unavailable"});
    const result = await deliverPreparedInvitation(db as unknown as SupabaseClient, prepared, "secret-token", "a".repeat(64));
    expect(result.sent).toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

});
