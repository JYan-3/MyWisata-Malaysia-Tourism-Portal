"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Shared card shell for discovery cards (ActivityCard, VendorCard): media, title, optional price,
 * and a details drawer that opens on hover or keyboard focus and floats over the next grid row.
 * Each card keeps its own data and links and only passes content in.
 * The drawer styles are the `.mw-card-expand-card` rules in app/globals.css.
 */
export function ExpandCard({ media, title, previewTitle, previewLabel, price, details, detailsId, action }: {
  media: ReactNode;
  title: ReactNode;
  previewTitle: string;
  previewLabel: string;
  price?: ReactNode;
  details: ReactNode;
  detailsId: string;
  action: { href: string; label: string; onClick?: () => void };
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  function handleCardClickCapture(event: React.MouseEvent<HTMLElement>) {
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 767px)").matches) return;

    let target = event.target as Node | null;
    while (target && target !== event.currentTarget) {
      if (target.nodeType === 1) {
        const element = target as Element;
        if (element.tagName === "BUTTON" || element.hasAttribute("data-card-primary-cta")) return;
        if (element.tagName === "A") {
          if (!element.hasAttribute("data-card-preview-trigger")) return;
          event.preventDefault();
          setPreviewOpen(true);
          return;
        }
      }
      target = target.parentNode;
    }

    setPreviewOpen(true);
  }

  return (
    <article className="mw-card mw-card-expand-card group" onClickCapture={handleCardClickCapture}>
      <div className="mw-card-media">{media}</div>
      <div className="mw-card-body mw-card-body-compact space-y-2 p-4">
        {title}
        <div className="mw-card-footer mw-card-footer-stacked pt-1">
          {price && <div className="mw-card-price-row">{price}</div>}
          <div className="mw-card-cta-row">
            <Button asChild size="sm" className="h-9 w-full rounded-full px-3 text-center text-xs font-bold">
              <Link href={action.href} onClick={action.onClick} data-card-primary-cta="true">{action.label}</Link>
            </Button>
            <div className="mw-card-cta-drawer">
              <div id={detailsId} data-card-details-inline="true" className="mw-card-details-expand">
                <div className="mw-card-details-expand-inner"><div className="space-y-2 border-t border-dashed border-border pb-3 pt-3">{details}</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="fixed inset-x-0 top-auto bottom-0 left-0 z-50 grid max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 gap-4 overflow-y-auto rounded-t-2xl rounded-b-none border-x-0 border-b-0 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl duration-200 md:inset-auto md:top-1/2 md:left-1/2 md:w-[calc(100%-2rem)] md:max-w-lg md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-lg md:border-b md:p-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>{previewTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">{details}</div>
          <Button asChild className="w-full rounded-full">
            <Link href={action.href} onClick={action.onClick}>{previewLabel}</Link>
          </Button>
        </DialogContent>
      </Dialog>
    </article>
  );
}
