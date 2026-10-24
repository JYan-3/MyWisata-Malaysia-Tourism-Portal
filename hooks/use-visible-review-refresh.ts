"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type VisibleReviewRefreshOptions = {
  enabled: boolean;
  onRefresh: (signal: AbortSignal) => Promise<unknown> | unknown;
  intervalMs?: number;
};

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_INTERVAL_MS = 120_000;

/** Refresh a bounded review list only while visible; serialize and back off failing reads. */
export function useVisibleReviewRefresh({
  enabled,
  onRefresh,
  intervalMs = 30_000,
}: VisibleReviewRefreshOptions) {
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [hasRefreshError, setHasRefreshError] = useState(false);
  const manualRef = useRef<(() => Promise<void>) | null>(null);
  const refresh = useCallback(() => { void manualRef.current?.(); }, []);
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;
    let timer: number | null = null;
    let timeout: number | null = null;
    let inFlight = false;
    let failureCount = 0;
    let controller: AbortController | null = null;
    let accessDenied = false;

    const isVisible = () => document.visibilityState === "visible";
    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clearTimer();
      if (!isMounted || !isVisible() || inFlight || accessDenied) return;
      const delay = Math.min(intervalMs * (2 ** failureCount), MAX_INTERVAL_MS);
      timer = window.setTimeout(() => { void runRefresh(); }, delay);
    };
    const runRefresh = async () => {
      clearTimer();
      if (!isMounted || !isVisible() || inFlight || accessDenied) return;
      inFlight = true;
      controller = new AbortController();
      const activeController = controller;
      timeout = window.setTimeout(() => activeController.abort(), REQUEST_TIMEOUT_MS);
      try {
        await refreshRef.current(activeController.signal);
        if (!activeController.signal.aborted) { failureCount = 0; if (isMounted) { setLastSuccessAt(Date.now()); setHasRefreshError(false); } }
        else failureCount += 1;
      } catch (error) {
        if (error && typeof error === "object" && "status" in error && (error.status === 401 || error.status === 403)) accessDenied = true;
        if (isMounted) setHasRefreshError(true);
        failureCount += 1;
      } finally {
        if (timeout !== null) window.clearTimeout(timeout);
        timeout = null;
        if (controller === activeController) controller = null;
        inFlight = false;
        schedule();
      }
    };
    manualRef.current = async () => { accessDenied = false; await runRefresh(); };
    const onVisibilityChange = () => {
      if (!isVisible()) {
        clearTimer();
        return;
      }
      void runRefresh();
    };
    const onFocus = () => { void runRefresh(); };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    schedule();

    return () => {
      isMounted = false;
      manualRef.current = null;
      clearTimer();
      if (timeout !== null) window.clearTimeout(timeout);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, intervalMs]);
  return { lastSuccessAt, hasRefreshError, refresh };
}
