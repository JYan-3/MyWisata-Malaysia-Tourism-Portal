import { act, useEffect, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findOne, installTestDom, TestElement, TestEvent, type TestDocument } from "@/components/shared/__tests__/render-test-dom";
import type { ImageShape } from "@/lib/media/image-aspect";

const size = vi.hoisted(() => ({ width: 1600, height: 1200 }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-easy-crop", () => ({ default: () => null }));
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => <div {...props}>{children}</div>;
  return { Dialog: Pass, DialogContent: Pass, DialogDescription: Pass, DialogFooter: Pass, DialogHeader: Pass, DialogTitle: Pass };
});

import { useImageCrop } from "../image-crop-dialog";

let document: TestDocument;
let createRoot: typeof import("react-dom/client").createRoot;
let container: TestElement;
let root: ReturnType<typeof createRoot>;
const captured: { hook?: ReturnType<typeof useImageCrop> } = {};

function Harness() {
  const imageCrop = useImageCrop();
  useEffect(() => { captured.hook = imageCrop; });
  return <>{imageCrop.cropDialog}</>;
}

beforeAll(async () => {
  document = installTestDom();
  ({ createRoot } = await import("react-dom/client"));
});

beforeEach(async () => {
  // Image loads asynchronously with the configured natural size.
  vi.stubGlobal("Image", class {
    naturalWidth = size.width;
    naturalHeight = size.height;
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL: () => "blob:photo", revokeObjectURL: vi.fn() }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element);
  await act(async () => { root.render(<Harness />); });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
  vi.unstubAllGlobals();
});

const photo = new File(["x"], "stall.jpg", { type: "image/jpeg" });

// Wrapped so awaiting pick() does not also wait for the crop itself to finish.
async function pick(shape: ImageShape): Promise<{ result: Promise<File | null> }> {
  let result: Promise<File | null> = Promise.resolve(null);
  await act(async () => {
    result = captured.hook!.cropToShape(photo, shape);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { result };
}

describe("useImageCrop", () => {
  it("returns a photo that already fits the shape unchanged, without opening the dialog", async () => {
    size.width = 1600; size.height = 1200;
    await expect((await pick("photo")).result).resolves.toBe(photo);
    expect(container.textContent).not.toContain("imageCrop.title");
  });

  it("opens the crop dialog for a photo of another shape and returns nothing when cancelled", async () => {
    size.width = 3024; size.height = 4032;
    const { result } = await pick("photo");
    expect(container.textContent).toContain("imageCrop.title");
    expect(findOne(container, (element) => element.getAttribute("data-image-crop-dialog") === "photo")).toBeTruthy();

    const cancel = findOne(container, (element) => element.tagName === "BUTTON" && element.textContent === "actions.cancel");
    await act(async () => { cancel.dispatchEvent(new TestEvent("click", { bubbles: true })); });

    await expect(result).resolves.toBeNull();
    expect(container.textContent).not.toContain("imageCrop.title");
  });
});
