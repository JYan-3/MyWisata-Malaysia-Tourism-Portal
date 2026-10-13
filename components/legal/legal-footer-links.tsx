"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { legalNavItems } from "@/components/legal/legal-nav";

/**
 * Privacy, Terms, Data & KYC and Help Center links for page footers outside the
 * legal section (login, guest browsing). The legal pages themselves render the
 * full nav in app/legal/layout.tsx.
 */
export function LegalFooterLinks({ className }: { className?: string }) {
  const { t } = useTranslation("customer");
  const items = [
    ...legalNavItems(t).filter((item) => item.href !== "/legal/about"),
    { href: "/help", label: t("legal.nav.help") },
  ];
  return (
    <nav aria-label={t("legal.nav.footerLabel")} className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs", className)}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
