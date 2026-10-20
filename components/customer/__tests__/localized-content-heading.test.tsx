import React, { act, type ComponentType } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElements, findOne, installTestDom, TestEvent, type TestDocument, type TestElement } from "@/components/shared/__tests__/render-test-dom";

const { requestContentTranslation } = vi.hoisted(() => ({ requestContentTranslation: vi.fn() }));

vi.mock("@/lib/content-translations/client-batcher", () => ({ requestContentTranslation }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en" },
  }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

import * as localizedContentModule from "@/components/customer/localized-content";

type LocalizedContentHeadingProps = {
  entityType: "product";
  entityId: string;
  field: "name";
  sourceText: string;
  href?: string;
  headingClassName?: string;
  linkClassName?: string;
  showTitleAttribute?: boolean;
};

const LocalizedContentHeading = (
  localizedContentModule as unknown as { LocalizedContentHeading?: ComponentType<LocalizedContentHeadingProps> }
).LocalizedContentHeading;

let document: TestDocument;
let container: TestElement;
let createRoot: typeof import("react-dom/client").createRoot;
let root: ReturnType<typeof import("react-dom/client").createRoot> | undefined;

async function render(props: LocalizedContentHeadingProps) {
  await act(async () => {
    root?.render(LocalizedContentHeading ? <LocalizedContentHeading {...props} /> : null);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeAll(async () => {
  document = installTestDom();
  ({ createRoot } = await import("react-dom/client"));
});

beforeEach(() => {
  requestContentTranslation.mockReset();
  requestContentTranslation.mockResolvedValue({ translatedText: "Translated title", pending: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element);
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.removeChild(container);
});

if (!LocalizedContentHeading) {
  it("exports the serializable localized heading adapter", () => {
    expect(LocalizedContentHeading).toBeTypeOf("function");
  });
} else {
  describe("LocalizedContentHeading", () => {
    it("keeps the title inside its link and translation controls outside it", async () => {
      await render({
        entityType: "product",
        entityId: "product-1",
        field: "name",
        sourceText: "Original title",
        href: "/customer/activity/product-1",
        linkClassName: "title-link",
        headingClassName: "title-heading",
        showTitleAttribute: true,
      });

      const link = findOne(container, (element) => element.tagName === "A");
      const heading = findOne(container, (element) => element.tagName === "H3");
      const toggle = findOne(container, (element) => element.tagName === "BUTTON");

      expect(link.getAttribute("href")).toBe("/customer/activity/product-1");
      expect(link.className).toBe("title-link");
      expect(heading.className).toBe("title-heading");
      expect(heading.textContent).toBe("Translated title");
      expect(link.getAttribute("title")).toBe("Translated title");
      expect(link.contains(heading)).toBe(true);
      expect(link.contains(toggle)).toBe(false);

      await act(async () => {
        toggle.dispatchEvent(new TestEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(heading.textContent).toBe("Original title");
      expect(findElements(container, (element) => element.tagName === "BUTTON")).toHaveLength(1);
    });

    it("renders an unlinked heading when no destination is provided", async () => {
      await render({
        entityType: "product",
        entityId: "product-2",
        field: "name",
        sourceText: "Standalone title",
        headingClassName: "standalone-heading",
      });

      const heading = findOne(container, (element) => element.tagName === "H3");
      expect(heading.textContent).toBe("Translated title");
      expect(heading.className).toBe("standalone-heading");
      expect(findElements(container, (element) => element.tagName === "A")).toHaveLength(0);
    });
  });
}
