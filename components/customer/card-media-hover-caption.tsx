import type { ReactNode } from "react";

/** Shared hover/focus caption treatment for cards that show brief media details. */
export function CardMediaHoverCaption({ children }: { children: ReactNode }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-primary/95 via-primary/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
      />
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 translate-y-2 space-y-1 text-left text-white opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none">
        {children}
      </div>
    </>
  );
}
