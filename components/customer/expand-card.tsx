"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shared card shell for discovery cards (ActivityCard, VendorCard): media, title, optional price,
 * and a details drawer that opens on hover or keyboard focus and floats over the next grid row.
 * Each card keeps its own data and links and only passes content in.
 * The drawer styles are the `.mw-card-expand-card` rules in app/globals.css.
 */
export function ExpandCard({ media, title, price, details, detailsId, action }: {
  media: ReactNode;
  title: ReactNode;
  price?: ReactNode;
  details: ReactNode;
  detailsId: string;
  action: { href: string; label: string; onClick?: () => void };
}) {
  return (
    <article className="mw-card mw-card-expand-card group">
      <div className="mw-card-media">{media}</div>
      <div className="mw-card-body mw-card-body-compact space-y-2 p-4">
        {title}
        <div className="mw-card-footer mw-card-footer-stacked pt-1">
          {price && <div className="mw-card-price-row">{price}</div>}
          <div className="mw-card-cta-row">
            <div className="mw-card-cta-drawer">
              <div id={detailsId} data-card-details-inline="true" className="mw-card-details-expand">
                <div className="mw-card-details-expand-inner"><div className="space-y-2 border-t border-dashed border-border pb-3 pt-3">{details}</div></div>
              </div>
              <Button asChild size="sm" className="h-9 w-full rounded-full px-3 text-center text-xs font-bold">
                <Link href={action.href} onClick={action.onClick} data-card-primary-cta="true">{action.label}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
