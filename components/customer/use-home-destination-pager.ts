"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decideWheelTurn,
  INITIAL_WHEEL_TURN_STATE,
} from "@/lib/customer/wheel-page-turn";

type PagerState = {
  page: number;
  pageCount: number;
  progress: number;
};

const INITIAL_PAGER_STATE: PagerState = { page: 0, pageCount: 1, progress: 0 };

export function useHomeDestinationPager(viewportRef: React.RefObject<HTMLElement | null>) {
  const [pager, setPager] = useState<PagerState>(INITIAL_PAGER_STATE);
  const metricsRef = useRef({ pageStep: 0, pageCount: 1 });
  const wheelTurnRef = useRef(INITIAL_WHEEL_TURN_STATE);
  const pendingPageRef = useRef<number | null>(null);
  const pendingPageTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const sync = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth === 0) return;

    const pageStep = viewport.clientWidth;
    const pageCount = Math.max(1, Math.round(viewport.scrollWidth / pageStep));
    const maxPage = pageCount - 1;
    const progress = Math.min(Math.max(viewport.scrollLeft / pageStep, 0), maxPage);
    const page = Math.round(progress);
    metricsRef.current = { pageStep, pageCount };

    setPager((previous) => (
      previous.page === page && previous.pageCount === pageCount && previous.progress === progress
        ? previous
        : { page, pageCount, progress }
    ));
  }, [viewportRef]);

  const goToPage = useCallback((requestedPage: number) => {
    const viewport = viewportRef.current;
    const { pageStep, pageCount } = metricsRef.current;
    if (!viewport || pageStep === 0) return;

    const page = Math.min(Math.max(requestedPage, 0), pageCount - 1);
    pendingPageRef.current = page;
    if (pendingPageTimerRef.current !== null) window.clearTimeout(pendingPageTimerRef.current);
    pendingPageTimerRef.current = window.setTimeout(() => {
      pendingPageRef.current = null;
      pendingPageTimerRef.current = null;
    }, 350);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollTo({ left: page * pageStep, behavior: reducedMotion ? "auto" : "smooth" });
  }, [viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const scheduleSync = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        sync();
      });
    };
    const onWheel = (event: WheelEvent) => {
      const result = decideWheelTurn(wheelTurnRef.current, {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        now: performance.now(),
      });
      wheelTurnRef.current = result.state;
      if (result.turn === 0) return;

      const currentPage = pendingPageRef.current ?? Math.round(viewport.scrollLeft / metricsRef.current.pageStep);
      const targetPage = Math.min(Math.max(currentPage + result.turn, 0), metricsRef.current.pageCount - 1);
      if (targetPage === currentPage) return;

      event.preventDefault();
      goToPage(targetPage);
    };
    const observer = new ResizeObserver(sync);

    sync();
    observer.observe(viewport);
    viewport.addEventListener("scroll", scheduleSync, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", scheduleSync);
      viewport.removeEventListener("wheel", onWheel);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (pendingPageTimerRef.current !== null) window.clearTimeout(pendingPageTimerRef.current);
    };
  }, [goToPage, sync, viewportRef]);

  return { ...pager, goToPage };
}
