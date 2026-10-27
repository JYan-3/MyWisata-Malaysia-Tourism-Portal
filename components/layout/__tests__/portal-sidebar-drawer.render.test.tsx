import { act, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Package } from "lucide-react";
import { findElements, findOne, installTestDom, TestEvent, type TestDocument, type TestElement } from "@/components/shared/__tests__/render-test-dom";

vi.mock("next/navigation", () => ({ usePathname: () => "/vendor/products" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/components/shared/mylawatan-logo", () => ({ MyLawatanMark: () => <span data-logo /> }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div data-open-dialog>{children}</div> : null),
  DialogContent: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => <div {...props}>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

import { PortalSidebar } from "../portal-sidebar";

let document: TestDocument;
let createRoot: typeof import("react-dom/client").createRoot;
let container: TestElement;
let root: ReturnType<typeof createRoot>;

beforeAll(async () => {
  document = installTestDom();
  ({ createRoot } = await import("react-dom/client"));
});
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
});

async function render(fixed: boolean) {
  await act(async () => {
    root.render(
      <PortalSidebar
        portalName="Vendor Portal"
        brandName="Malaysia Tourism"
        navigationLabel="Portal navigation"
        contextLabel="Vendor Owner"
        menuLabel="Open navigation menu"
        sections={[
          { label: "Selling", items: [{ href: "/vendor/products", label: "Products", icon: Package }] },
          { label: "Money", items: [{ href: "/vendor/wallet", label: "Wallet", icon: Package }] },
        ]}
        fixed={fixed}
      />,
    );
  });
}

const menuButton = () => findOne(container, (element) => element.getAttribute("data-portal-menu-button") !== null);
async function click(element: TestElement) {
  await act(async () => { element.dispatchEvent(new TestEvent("click", { bubbles: true })); });
}

describe("PortalSidebar on phones", () => {
  it("replaces the bottom strip with a labelled menu button that opens the grouped menu as a drawer", async () => {
    await render(true);
    const aside = findOne(container, (element) => element.tagName === "ASIDE");
    expect(aside.className).toContain("max-lg:hidden");
    expect(menuButton().getAttribute("aria-label")).toBe("Open navigation menu");
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent?.match(/Products/g)).toHaveLength(1);

    await click(menuButton());
    const drawer = findOne(container, (element) => element.getAttribute("data-portal-drawer") !== null);
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    expect(drawer.textContent).toContain("Selling");
    expect(drawer.textContent).toContain("Money");
    expect(findOne(drawer, (element) => element.tagName === "A" && element.textContent === "Products").getAttribute("aria-current")).toBe("page");
  });

  it("closes the drawer when a page is chosen", async () => {
    await render(true);
    await click(menuButton());
    const drawer = findOne(container, (element) => element.getAttribute("data-portal-drawer") !== null);
    await click(findOne(drawer, (element) => element.tagName === "A" && element.textContent === "Wallet"));
    expect(findElements(container, (element) => element.getAttribute("data-portal-drawer") !== null)).toHaveLength(0);
  });

  it("adds no phone menu to a non-fixed sidebar", async () => {
    await render(false);
    expect(findElements(container, (element) => element.getAttribute("data-portal-menu-button") !== null)).toHaveLength(0);
  });
});
