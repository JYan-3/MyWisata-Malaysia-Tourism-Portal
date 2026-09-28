import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findOne, installTestDom, TestEvent, type TestDocument, type TestElement } from "@/components/shared/__tests__/render-test-dom";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  currentUser: { id: "creator-1" } as { id: string } | null,
}));

vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return {
    useTranslation: () => ({ t, i18n: { resolvedLanguage: "en" } }),
  };
});
vi.mock("@/components/providers/app-dialog", () => ({ useAppDialog: () => ({ confirm: vi.fn(), prompt: vi.fn() }) }));
vi.mock("@/components/providers/auth", () => ({ useAuth: () => ({ currentUser: mocks.currentUser }) }));

import PromotionCampaignsPage from "@/app/admin/promotion-campaigns/page";

let createRoot: typeof import("react-dom/client").createRoot;
let document: TestDocument;
let container: TestElement;
let root: ReturnType<typeof import("react-dom/client").createRoot>;

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function campaignPayload(status: "draft" | "pending_approval" = "draft") {
  return response({ data: {
    campaigns: [{
      id: "campaign-1", slug: "heritage-walk-kl-current-offers", title: "Heritage Walk KL — Local Explorer Picks",
      summary: "Offers from Heritage Walk KL", description: "Existing outlet products and voucher.",
      poster_url: "https://x/poster.jpg", operating_hours: "10:00 AM - 6:00 PM", status,
      starts_at: "2026-09-25T10:50:00.000Z", ends_at: "2027-03-12T23:00:00.000Z",
      created_by: "creator-1", updated_at: "2026-09-25T11:28:22.000Z", rejection_note: null,
    }],
  }, error: null });
}

async function click(element: TestElement) {
  await act(async () => {
    element.dispatchEvent(new TestEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Admin promotion campaign workbench", () => {
  beforeAll(async () => {
    document = installTestDom();
    ({ createRoot } = await import("react-dom/client"));
  });

  beforeEach(() => {
    mocks.currentUser = { id: "creator-1" };
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockReset().mockResolvedValue(campaignPayload());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
    vi.unstubAllGlobals();
  });

  it("renders a localized loading state while staff campaigns load", () => {
    const markup = renderToStaticMarkup(<PromotionCampaignsPage />);

    expect(markup).toContain("promotionCampaigns.title");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("promotionCampaigns.states.loading");
    expect(markup).not.toContain("promotionCampaigns.form.saveDraft");
  });

  it("offers review actions to the campaign creator now that self-approval is allowed", async () => {
    mocks.fetch.mockResolvedValue(campaignPayload("pending_approval"));

    await act(async () => {
      root.render(<PromotionCampaignsPage />);
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("promotionCampaigns.status.pending_approval");
    expect(container.textContent).toContain("promotionCampaigns.actions.approve");
    expect(container.textContent).toContain("promotionCampaigns.actions.reject");
  });

  it("keeps review actions available to an independent campaign reviewer", async () => {
    mocks.currentUser = { id: "reviewer-2" };
    mocks.fetch.mockResolvedValue(campaignPayload("pending_approval"));

    await act(async () => {
      root.render(<PromotionCampaignsPage />);
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("promotionCampaigns.actions.approve");
    expect(container.textContent).toContain("promotionCampaigns.actions.reject");
  });

  it("populates the edit form with the event's poster, hours, and copy — not an offers picker", async () => {
    await act(async () => {
      root.render(<PromotionCampaignsPage />);
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Heritage Walk KL — Local Explorer Picks");

    const editDraft = findOne(container, (element) => element.tagName === "BUTTON" && element.textContent.includes("promotionCampaigns.actions.edit"));
    await click(editDraft);

    const titleInput = findOne(container, (element) => element.tagName === "INPUT" && element.value === "Heritage Walk KL — Local Explorer Picks");
    expect(titleInput).toBeDefined();
    const hoursFromInput = findOne(container, (element) => element.tagName === "INPUT" && element.type === "time" && element.value === "10:00");
    expect(hoursFromInput).toBeDefined();
    const hoursToInput = findOne(container, (element) => element.tagName === "INPUT" && element.type === "time" && element.value === "18:00");
    expect(hoursToInput).toBeDefined();
    expect(container.textContent).toContain("promotionCampaigns.form.removePoster");
    expect(container.textContent).not.toContain("promotionCampaigns.form.offerType");
    expect(container.textContent).not.toContain("promotionCampaigns.form.chooseSource");
  });
});
