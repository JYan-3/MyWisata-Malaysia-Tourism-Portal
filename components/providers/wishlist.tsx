"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/components/providers/auth";

type WishlistContextValue = {
  savedIds: ReadonlySet<string>;
  loading: boolean;
  toggleSaved: (productId: string) => Promise<boolean>;
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { currentUser, loading: authLoading } = useAuth();
  const currentUserId = currentUser?.id;
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return () => { cancelled = true; };
    if (!currentUserId) {
      // Reset private client state as the auth identity transitions to guest.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedIds(new Set());
      setLoading(false);
      return () => { cancelled = true; };
    }

    // Reset the previous identity's data before hydrating the active customer.
    setSavedIds(new Set());
    setLoading(true);
    fetch("/api/wishlist")
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { data?: { productIds?: string[] } };
        if (!cancelled) setSavedIds(new Set(body.data?.productIds ?? []));
      })
      .catch(() => {
        // Wishlist is an enhancement; browsing must remain available if it fails.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, currentUserId]);

  const toggleSaved = useCallback(async (productId: string) => {
    const wasSaved = savedIds.has(productId);
    const nextSaved = !wasSaved;
    setSavedIds((current) => {
      const next = new Set(current);
      if (nextSaved) next.add(productId);
      else next.delete(productId);
      return next;
    });

    try {
      const response = await fetch("/api/wishlist", {
        method: nextSaved ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      if (!response.ok) throw new Error("Wishlist update failed");
      return nextSaved;
    } catch {
      setSavedIds((current) => {
        const next = new Set(current);
        if (wasSaved) next.add(productId);
        else next.delete(productId);
        return next;
      });
      return wasSaved;
    }
  }, [savedIds]);

  const value = useMemo(() => ({ savedIds, loading, toggleSaved }), [savedIds, loading, toggleSaved]);
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) throw new Error("useWishlist must be used within WishlistProvider");
  return context;
}
