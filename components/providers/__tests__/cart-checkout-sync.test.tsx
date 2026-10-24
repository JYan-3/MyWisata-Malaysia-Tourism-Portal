import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestDom, type TestDocument } from "@/components/shared/__tests__/render-test-dom";

const state = vi.hoisted(() => ({
  pathname: "/customer/checkout",
  currentUser: { id: "customer-1" },
  getCart: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/components/providers/auth", () => ({ useAuth: () => ({ currentUser: state.currentUser }) }));
vi.mock("@/backend/domains/commerce", () => ({ getCart: state.getCart }));
vi.mock("@/backend/domains/catalogue", () => ({ getActivitiesByIds: vi.fn(async () => []) }));
vi.mock("@/backend/core/helpers", () => ({ cartItemKey: vi.fn(() => "product-1|variant-1||outlet-1"), cartTotals: vi.fn() }));

import { CartProvider, useCart } from "@/components/providers/cart";

let createRoot: typeof import("react-dom/client").createRoot;
let document: TestDocument;

function CartCount({ path }: { path: string }) {
  return <span data-path={path}>{useCart().count}</span>;
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("cart state after completed checkout", () => {
  beforeAll(async () => {
    document = installTestDom();
    ({ createRoot } = await import("react-dom/client"));
  });

  beforeEach(() => {
    state.pathname = "/customer/checkout";
    state.getCart.mockReset();
    state.getCart
      .mockResolvedValueOnce([{ activityId: "product-1", variantId: "variant-1", outletId: "outlet-1", qty: 1 }])
      .mockResolvedValueOnce([]);
  });

  it("reloads the server cart when a successful checkout opens its order", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const renderApp = () => <CartProvider><CartCount path={state.pathname} /></CartProvider>;

    await act(async () => { root.render(renderApp()); await settle(); });
    expect(container.textContent).toBe("1");
    expect(state.getCart).toHaveBeenCalledTimes(1);

    state.pathname = "/customer/checkout/simulator/session-1";
    await act(async () => { root.render(renderApp()); await settle(); });
    expect(state.getCart).toHaveBeenCalledTimes(1);

    state.pathname = "/customer/orders/order-1";
    await act(async () => { root.render(renderApp()); await settle(); });
    expect(state.getCart).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("0");

    act(() => root.unmount());
    document.body.removeChild(container);
  });
  it("keeps selected items when auth refresh returns the same account", async()=>{
    const values=new Map<string,string>();
    vi.stubGlobal("sessionStorage",{getItem:(key:string)=>values.get(key) ?? null,setItem:(key:string,value:string)=>values.set(key,value)});
    state.getCart.mockReset().mockResolvedValueOnce([{activityId:"product-1",variantId:"variant-1",outletId:"outlet-1",qty:1}]).mockImplementationOnce(()=>new Promise(()=>{}));
    let cart!:ReturnType<typeof useCart>;
    function Probe(){const value=useCart();React.useLayoutEffect(()=>{cart=value;});return null;}
    const container=document.createElement("div");const root=createRoot(container as unknown as Element);
    await act(async()=>{root.render(<CartProvider><Probe/></CartProvider>);await settle();});
    await act(async()=>cart.setSelectedKeys(["product-1|variant-1||outlet-1"]));
    state.currentUser={...state.currentUser};
    await act(async()=>{root.render(<CartProvider><Probe/></CartProvider>);await settle();});
    expect(cart.selectedItems).toHaveLength(1);
    expect(state.getCart).toHaveBeenCalledTimes(1);
    await act(async()=>root.unmount());vi.unstubAllGlobals();
  });

});
