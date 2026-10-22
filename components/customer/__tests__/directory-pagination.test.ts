import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key}${values ? ` ${Object.values(values).join(" ")}` : ""}`,
  }),
}));

const { DirectoryPagination, getPageItems } = await import("@/components/customer/directory-pagination");

describe("getPageItems", () => {
  it("lists every page when there are seven or fewer", () => {
    expect(getPageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("collapses the middle with an ellipsis when near the start", () => {
    expect(getPageItems(1, 20)).toEqual([1, 2, "ellipsis", 20]);
  });

  it("keeps a window around the current page", () => {
    expect(getPageItems(10, 20)).toEqual([1, "ellipsis", 9, 10, 11, "ellipsis", 20]);
  });

  it("collapses the middle when near the end", () => {
    expect(getPageItems(20, 20)).toEqual([1, "ellipsis", 19, 20]);
  });

  it("never emits a page outside the range", () => {
    expect(getPageItems(1, 1)).toEqual([1]);
  });

  it("renders a compact current-page status with only previous and next controls", () => {
    const markup = renderToStaticMarkup(createElement(DirectoryPagination, {
      ariaLabel: "Place pages",
      currentPage: 2,
      itemLabel: "places",
      onPageChange: () => undefined,
      pageSize: 15,
      totalItems: 46,
      totalPages: 4,
      variant: "compact",
    }));

    expect(markup).toContain('data-pagination-variant="compact"');
    expect(markup).toContain("ui.pagination.pageOf 2 4");
    expect(markup.match(/<button/g)).toHaveLength(2);
  });

  it("renders numbered pages with the token-based marketplace presentation", () => {
    const markup = renderToStaticMarkup(createElement(DirectoryPagination, {
      ariaLabel: "Experience pages",
      currentPage: 2,
      itemLabel: "experiences",
      onPageChange: () => undefined,
      pageSize: 8,
      totalItems: 30,
      totalPages: 4,
      variant: "marketplace",
    }));

    expect(markup).toContain('data-pagination-variant="marketplace"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("bg-primary text-primary-foreground");
    expect(markup).toContain("border border-border bg-card text-primary");
    expect(markup).toContain("ui.pagination.showing 9 16 30 experiences");
    expect(markup.match(/<button/g)).toHaveLength(6);
  });
});
