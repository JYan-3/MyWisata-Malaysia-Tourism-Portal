"use client";

import {
  wormIndicatorGeometry,
  type WormSizes,
} from "@/lib/customer/worm-indicator";

type HomeDestinationWormIndicatorProps = {
  count: number;
  progress: number;
  current: number;
  sizes: WormSizes;
  label: string;
  pageLabel: (page: number, count: number) => string;
  onSelect: (page: number) => void;
};

export function HomeDestinationWormIndicator({
  count,
  progress,
  current,
  sizes,
  label,
  pageLabel,
  onSelect,
}: HomeDestinationWormIndicatorProps) {
  const { widths, pillLeft, pillWidth } = wormIndicatorGeometry(progress, count, sizes);

  return (
    <div
      role="group"
      aria-label={label}
      className="relative flex w-max items-center"
      style={{ gap: sizes.gap }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 z-0 rounded-full bg-[#f4bd00]"
        style={{ left: pillLeft, width: pillWidth }}
      />
      {widths.map((width, page) => (
        <button
          key={page}
          type="button"
          aria-label={pageLabel(page + 1, count)}
          aria-current={current === page ? "page" : undefined}
          onClick={() => onSelect(page)}
          className="relative z-10 shrink-0 rounded-full bg-white/35 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f4bd00]/40"
          style={{ width, height: sizes.dot }}
        >
          <span className="sr-only">{pageLabel(page + 1, count)}</span>
        </button>
      ))}
    </div>
  );
}
