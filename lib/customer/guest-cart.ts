import type { CartItem } from "@/backend/core/types";

async function guestCartRequest(method: string, body?: unknown): Promise<CartItem[]> {
  if (method !== "GET") {
    const session = await fetch("/api/guest/session", { method: "POST", credentials: "same-origin" });
    if (!session.ok) throw new Error("Guest checkout is unavailable");
  }
  const response = await fetch("/api/guest/cart", { method, credentials: "same-origin", cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("Unable to update the guest cart");
  const payload = await response.json();
  return payload.data.items;
}
export const getGuestCart = () => guestCartRequest("GET");
export const addGuestCartItem = (item: CartItem) => guestCartRequest("POST", { item });
export const updateGuestCartQty = (key: string, quantity: number) => guestCartRequest("PATCH", { key, quantity });
export const removeGuestCartItem = (key: string) => updateGuestCartQty(key, 0);
export const clearGuestCart = () => guestCartRequest("DELETE");
