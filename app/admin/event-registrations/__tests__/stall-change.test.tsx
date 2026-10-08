import React, { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findElements,
  findOne,
  installTestDom,
  TestEvent,
  type TestDocument,
  type TestElement,
} from "@/components/shared/__tests__/render-test-dom";

const REGISTRATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const VENDOR_ID = "33333333-3333-4333-8333-333333333333";
const UPDATED_AT = "2026-10-07T00:00:00.000Z";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  showFeedback: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: (() => {
    const t = (key: string) => key;
    return () => ({ t, i18n: { resolvedLanguage: "en" } });
  })(),
}));
vi.mock("@/components/providers/action-feedback", () => ({ useActionFeedback: () => ({ showFeedback: mocks.showFeedback }) }));
vi.mock("@/components/providers/app-dialog", () => ({ useAppDialog: () => ({ prompt: mocks.prompt }) }));
vi.mock("@/components/admin/admin-page-shell", () => ({
  AdminMetricGrid: () => <div />,
  AdminPageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  AdminPageHeader: ({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) => (
    <header><h1>{title}</h1><p>{description}</p>{actions}</header>
  ),
}));
vi.mock('@/components/admin/filter-bar', () => ({ AdminFilterBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, adminFilterControlClassName: '' }));
vi.mock('@/components/shared/empty-state', () => ({ EmptyState: ({ title }: { title: string }) => <p>{title}</p> }));
vi.mock("@/components/admin/confirm-dialog", () => ({
  AdminConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button data-testid="confirm-review" onClick={onConfirm}>confirm-review</button> : null,
}));
vi.mock("@/components/ui/button", () => ({ Button: (props: React.ComponentProps<"button">) => <button {...props} /> }));
vi.mock("@/components/ui/input", () => ({ Input: (props: React.ComponentProps<"input">) => <input {...props} /> }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} /> }));
vi.mock("@/components/ui/badge", () => ({ StatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <section role="dialog">{children}</section>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("lucide-react", () => ({ ArrowLeft: (props: Record<string, unknown>) => <svg {...props} />,
  ChevronRight: () => <svg />, ClipboardCheck: () => <svg />, Search: () => <svg /> }));

import EventRegistrationDetailPage from "@/app/admin/event-registrations/[id]/page";
import EventRegistrationsPage from '@/app/admin/event-registrations/page';

let createRoot: typeof import("react-dom/client").createRoot;
let document: TestDocument;
let container: TestElement;
let root: ReturnType<typeof import("react-dom/client").createRoot>;

const detail = {
  id: REGISTRATION_ID,
  campaignId: CAMPAIGN_ID,
  campaignTitle: "11.11 Market",
  locationName: "Sunway Pyramid, 2nd floor",
  vendorId: VENDOR_ID,
  vendorName: "Nasi Lemak House",
  stallNumber: "A12",
  stallDescription: "Traditional Malaysian favourites.",
  stallPosterUrl: "https://example.com/stall.jpg",
  status: "approved",
  rejectionReason: null,
  closedReason: null,
  changesRequestedReason: null,
  products: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: UPDATED_AT,
};

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

async function click(element: TestElement) {
  await act(async () => {
    element.dispatchEvent(new TestEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setValue(element: TestElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new TestEvent("input", { bubbles: true }));
    element.dispatchEvent(new TestEvent("change", { bubbles: true }));
  });
}

describe("Admin event registration stall changes", () => {
  beforeAll(async () => {
    document = installTestDom();
    ({ createRoot } = await import("react-dom/client"));
  });

  beforeEach(() => {
    mocks.fetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === `/api/admin/event-registrations/${REGISTRATION_ID}` && !init?.method) {
        return response({ data: { registration: detail }, error: null });
      }
      if (url === `/api/admin/event-registrations/${REGISTRATION_ID}/stall` && init?.method === "PATCH") {
        return response({ data: { notificationQueued: true }, error: null });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    mocks.showFeedback.mockReset();
    mocks.prompt.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
    vi.unstubAllGlobals();
  });

  it("lets Admin change an approved stall number with a reason and queues a vendor notice", async () => {
    await act(async () => {
      root.render(<EventRegistrationDetailPage params={Promise.resolve({ id: REGISTRATION_ID })} />);
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("eventRegistrations.changeStall");
    expect(container.textContent).not.toContain(REGISTRATION_ID);
    expect(container.textContent).not.toContain(CAMPAIGN_ID);
    expect(container.textContent).not.toContain(VENDOR_ID);

    await click(findOne(container, (element) =>
      element.tagName === "BUTTON" && element.textContent.includes("eventRegistrations.changeStall")));

    const inputs = findElements(container, (element) => element.tagName === "INPUT");
    const stallInput = findOne(container, (element) => element.tagName === "INPUT" && element.value === "A12");
    const reasonInput = findOne(container, (element) => element.tagName === "TEXTAREA");
    expect(inputs.length).toBeGreaterThanOrEqual(1);
    await setValue(stallInput, "B08");
    await setValue(reasonInput, "Entrance layout changed");
    await click(findOne(container, (element) =>
      element.tagName === "BUTTON" && element.textContent.includes("eventRegistrations.confirmStallChange")));

    const mutation = mocks.fetch.mock.calls.find(([url, init]) =>
      url === `/api/admin/event-registrations/${REGISTRATION_ID}/stall` && (init as RequestInit | undefined)?.method === "PATCH");
    expect(mutation).toBeDefined();
    expect(JSON.parse(String((mutation![1] as RequestInit).body))).toEqual({
      stallNumber: "B08",
      expectedUpdatedAt: UPDATED_AT,
      reason: "Entrance layout changed",
    });
    expect(mocks.showFeedback).toHaveBeenCalledWith("success", "eventRegistrations.notificationQueued");
  });
  it("requires Admin to enter the confirmed booth when reviewing an application", async () => {
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init?.method) return response({ data: { registration: { ...detail, status: 'pending', stallNumber: '',
        requestedStallNumber: 'A12', locationMaxStalls: 30, locationOccupiedStalls: 29 } } });
      return response({ data: { ok: true, notificationQueued: true } });
    });
    await act(async () => {
      root.render(<EventRegistrationDetailPage params={Promise.resolve({ id: REGISTRATION_ID })} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const booth = findOne(container, (element) => element.tagName === 'INPUT' && element.getAttribute('id') === 'confirmed-stall-number');
    await setValue(booth, 'B08');
    await click(findOne(container, (element) => element.tagName === 'BUTTON' && element.textContent === 'eventRegistrations.actions.approve'));
    await click(findOne(container, (element) => element.getAttribute('data-testid') === 'confirm-review'));
    const mutation = mocks.fetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(JSON.parse(String((mutation![1] as RequestInit).body))).toMatchObject({ action: 'approve', stallNumber: 'B08', expectedUpdatedAt: UPDATED_AT });
  });
  it('shows and searches the requested booth for a pending application in the review queue', async () => {
    mocks.fetch.mockResolvedValue(response({ data: { registrations: [{ ...detail, status: 'pending', stallNumber: '', requestedStallNumber: 'A12' }] } }));
    await act(async () => { root.render(<EventRegistrationsPage />); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain('eventRegistrations.preferredStall');
    const search = findOne(container, (element) => element.tagName === 'INPUT');
    await setValue(search, 'A12');
    expect(container.textContent).toContain(detail.vendorName);
    await setValue(search, 'A13');
    expect(container.textContent).not.toContain(detail.vendorName);
  });
});
