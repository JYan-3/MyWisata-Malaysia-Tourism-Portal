import React, { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElements, findOne, installTestDom, TestEvent, type TestDocument, type TestElement } from "@/components/shared/__tests__/render-test-dom";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));

vi.mock("@/components/ui/dialog", async () => {
  const ReactModule = await import("react");
  const DialogState = ReactModule.createContext<{ open: boolean; onOpenChange: (open: boolean) => void }>({ open: false, onOpenChange: () => {} });

  return {
    Dialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) => (
      <DialogState.Provider value={{ open, onOpenChange }}>{children}</DialogState.Provider>
    ),
    DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
      const state = ReactModule.useContext(DialogState);
      if (!state.open) return null;

      return <>
        <button type="button" data-dialog-backdrop onClick={() => state.onOpenChange(false)} />
        <div role="dialog" {...props} onKeyDown={(event) => {
          if (event.key === "Escape") state.onOpenChange(false);
        }}>
          {children}
          <button type="button" data-dialog-close onClick={() => state.onOpenChange(false)}>Close</button>
        </div>
      </>;
    },
    DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  };
});

import { ExpandCard } from "@/components/customer/expand-card";

let createRoot: typeof import("react-dom/client").createRoot;
let document: TestDocument;
let container: TestElement;
let root: ReturnType<typeof import("react-dom/client").createRoot> | undefined;

async function render(element: React.ReactElement) {
  await act(async () => {
    root?.render(element);
    await Promise.resolve();
  });
}

async function click(element: TestElement) {
  let notPrevented = false;
  await act(async () => {
    notPrevented = element.dispatchEvent(new TestEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  return notPrevented;
}

function setMobileViewport(mobile: boolean) {
  const testWindow = globalThis.window as unknown as Window;
  testWindow.matchMedia = ((query: string) => ({
    matches: mobile && query === "(max-width: 767px)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as typeof window.matchMedia;
}

function card(onAction = vi.fn(), onSave = vi.fn(), onShare = vi.fn()) {
  return <ExpandCard
    media={<>
      <a href="/card" data-card-preview-trigger="true" aria-haspopup="dialog">Cover link</a>
      <button type="button" data-save-control onClick={onSave}>Save</button>
      <button type="button" data-share-control onClick={onShare}>Share</button>
    </>}
    title={<h3>Card title</h3>}
    previewTitle="Card title"
    previewLabel="View Details"
    details={<p>Card-specific details</p>}
    detailsId="card-details"
    action={{ href: "/card", label: "Book Now", onClick: onAction }}
  />;
}

describe("ExpandCard mobile details drawer", () => {
  beforeAll(async () => {
    document = installTestDom();
    ({ createRoot } = await import("react-dom/client"));
  });

  beforeEach(() => {
    setMobileViewport(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    document.body.removeChild(container);
  });

  it("opens the shared details dialog from a mobile preview surface and keeps the CTA route", async () => {
    await render(card());
    const trigger = findOne(container, (element) => element.getAttribute("data-card-preview-trigger") === "true");

    expect(await click(trigger)).toBe(false);
    expect(findElements(container, (element) => element.getAttribute("role") === "dialog")).toHaveLength(1);
    expect(container.textContent).toContain("Card title");
    expect(container.textContent).toContain("Card-specific details");
    const detailsLink = findOne(container, (element) => element.tagName === "A" && element.textContent === "View Details");
    expect(detailsLink.getAttribute("href")).toBe("/card");

    const primaryCta = findOne(container, (element) => element.getAttribute("data-card-primary-cta") === "true");
    expect(primaryCta.getAttribute("href")).toBe("/card");
  });

  it("does not let the preview intercept the primary CTA, save, or share controls", async () => {
    const onAction = vi.fn();
    const onSave = vi.fn();
    const onShare = vi.fn();
    await render(card(onAction, onSave, onShare));

    const primaryCta = findOne(container, (element) => element.getAttribute("data-card-primary-cta") === "true");
    expect(await click(primaryCta)).toBe(true);
    expect(onAction).toHaveBeenCalledOnce();
    expect(findElements(container, (element) => element.getAttribute("role") === "dialog")).toHaveLength(0);

    await click(findOne(container, (element) => element.hasAttribute("data-save-control")));
    await click(findOne(container, (element) => element.hasAttribute("data-share-control")));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onShare).toHaveBeenCalledOnce();
    expect(findElements(container, (element) => element.getAttribute("role") === "dialog")).toHaveLength(0);
  });

  it("closes from its close control, Escape, and backdrop", async () => {
    await render(card());
    const trigger = findOne(container, (element) => element.getAttribute("data-card-preview-trigger") === "true");

    await click(trigger);
    await click(findOne(container, (element) => element.hasAttribute("data-dialog-close")));
    expect(findElements(container, (element) => element.getAttribute("role") === "dialog")).toHaveLength(0);

    await click(trigger);
    const dialog = findOne(container, (element) => element.getAttribute("role") === "dialog");
    await act(async () => {
      dialog.dispatchEvent(Object.assign(new TestEvent("keydown", { bubbles: true }), { key: "Escape" }));
      await Promise.resolve();
    });
    expect(findElements(container, (element) => element.getAttribute("role") === "dialog")).toHaveLength(0);

    await click(trigger);
    await click(findOne(container, (element) => element.hasAttribute("data-dialog-backdrop")));
    expect(findElements(container, (element) => element.getAttribute("role") === "dialog")).toHaveLength(0);
  });

  it("leaves the card's ordinary navigation unchanged outside the mobile breakpoint", async () => {
    setMobileViewport(false);
    await render(card());
    const trigger = findOne(container, (element) => element.getAttribute("data-card-preview-trigger") === "true");

    expect(await click(trigger)).toBe(true);
    expect(findElements(container, (element) => element.getAttribute("role") === "dialog")).toHaveLength(0);
  });
});
