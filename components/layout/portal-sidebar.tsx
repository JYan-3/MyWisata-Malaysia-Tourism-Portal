"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/components/utils";
import { MyLawatanMark } from "@/components/shared/mylawatan-logo";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/shared/header-icon-button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export type PortalSidebarItem = {
  href: string;
  activeHref?: string;
  label: ReactNode;
  icon: LucideIcon;
  count?: number;
  countLabel?: string;
};

export type PortalSidebarSection = {
  label: ReactNode;
  items: PortalSidebarItem[];
};

export type PortalSidebarProps = {
  portalName: ReactNode;
  brandName: ReactNode;
  navigationLabel: string;
  contextLabel: ReactNode;
  contextDetail?: ReactNode;
  sections: PortalSidebarSection[];
  /** Small links under the menu (e.g. privacy and terms); open in a new tab so the portal stays put. */
  footerLinks?: { href: string; label: ReactNode }[];
  /** Fixed desktop sidebar; below the lg breakpoint it becomes a menu button that opens the same content as a drawer. */
  fixed?: boolean;
  /** Accessible name of the phone menu button. */
  menuLabel?: string;
  className?: string;
};

function itemPath(item: PortalSidebarItem) {
  return (item.activeHref ?? item.href).split("?")[0];
}

function isActive(pathname: string, item: PortalSidebarItem) {
  const path = itemPath(item);
  return pathname === path || pathname.startsWith(`${path}/`);
}

function SidebarBody({
  portalName,
  brandName,
  navigationLabel,
  contextLabel,
  contextDetail,
  sections,
  footerLinks,
  inDrawer = false,
  onNavigate,
}: Omit<PortalSidebarProps, "fixed" | "menuLabel" | "className"> & { inDrawer?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const visibleSections = sections.filter((section) => section.items.length > 0);

  return (
    <>
      {/* The drawer's close button sits top-right, so leave room for it beside the brand. */}
      <div className={cn("border-b border-white/10 px-4 py-4", inDrawer && "pr-14")}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm">
            <MyLawatanMark size={24} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-slate-400">{portalName}</p>
            <p className="truncate text-sm font-bold text-white">{brandName}</p>
          </div>
        </div>
      </div>

      <div className="border-b border-white/10 px-4 py-4">
        <div className="flex items-start gap-2.5">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0">
            <p className="whitespace-normal break-words text-sm font-semibold text-white">{contextLabel}</p>
            {contextDetail && <p className="mt-0.5 whitespace-normal break-words text-xs text-slate-400">{contextDetail}</p>}
          </div>
        </div>
      </div>

      <nav aria-label={navigationLabel} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-8">
        {visibleSections.map((section, sectionIndex) => (
          <div key={sectionIndex} data-sidebar-section={sectionIndex === 0 ? "first" : "group"} className="first:pt-0 pt-4">
            <p className="px-3 pb-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-slate-500">{section.label}</p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex min-h-9 items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                      inDrawer && "min-h-11",
                      active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-y-2 left-0 w-0.5 rounded-full transition-colors",
                        active ? "bg-primary" : "bg-transparent group-hover:bg-white/20",
                      )}
                    />
                    <item.icon size={17} className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.count != null && item.count > 0 && (
                      <span
                        className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-bold text-white"
                        aria-label={item.countLabel ?? String(item.count)}
                      >
                        {item.count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {footerLinks && footerLinks.length > 0 && (
        <div data-portal-sidebar-footer className="flex flex-wrap gap-x-3 gap-y-1 border-t border-white/10 px-4 py-3 text-[0.6875rem]">
          {footerLinks.map((link) => (
            <Link key={link.href} href={link.href} target="_blank" rel="noopener" className="text-slate-400 transition-colors hover:text-white">
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function PortalSidebar({ fixed = false, menuLabel = "Menu", className, ...body }: PortalSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside
        data-portal-sidebar="true"
        className={cn(
          "flex h-screen w-60 shrink-0 flex-col bg-slate-950 text-slate-200",
          fixed && "fixed inset-y-0 left-0 z-40 max-lg:hidden",
          className,
        )}
      >
        <SidebarBody {...body} />
      </aside>

      {/* Phones and tablets: the portal headers leave the top-left corner free for this button. */}
      {fixed && (
        <>
          <button
            type="button"
            data-portal-menu-button
            aria-label={menuLabel}
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className={cn(HEADER_ICON_BUTTON_CLASS, "fixed left-4 top-3.5 z-50 border border-border bg-card shadow-sm lg:hidden")}
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              data-portal-drawer
              aria-describedby={undefined}
              className="left-0 top-0 flex h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 border-r border-white/10 bg-slate-950 p-0 text-slate-200 sm:max-w-[85vw] lg:hidden"
            >
              <DialogTitle className="sr-only">{body.navigationLabel}</DialogTitle>
              <SidebarBody {...body} inDrawer onNavigate={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
}
