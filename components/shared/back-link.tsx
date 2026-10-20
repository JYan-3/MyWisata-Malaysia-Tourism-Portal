"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";

/**
 * True when the browser has a previous page to return to. `sameOriginOnly` refuses to go back to
 * another site (e.g. after returning from a payment provider) and uses the fallback instead.
 */
export function shouldGoBack(input: { historyLength: number; referrer: string; origin: string; sameOriginOnly?: boolean }): boolean {
  if (input.historyLength <= 1) return false;
  if (!input.sameOriginOnly || !input.referrer) return true;
  try {
    return new URL(input.referrer).origin === input.origin;
  } catch {
    return false;
  }
}

/** A back button that returns to the previous page, or to `fallbackHref` when there is none. */
export function BackLink({ fallbackHref, sameOriginOnly, onClick, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { fallbackHref: string; sameOriginOnly?: boolean }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    if (!shouldGoBack({ historyLength: window.history.length, referrer: document.referrer, origin: window.location.origin, sameOriginOnly })) return;
    event.preventDefault();
    window.history.back();
  }
  return <Link href={fallbackHref} onClick={handleClick} {...props} />;
}
