"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { MyWisataLogo } from "@/components/shared/mywisata-logo";
import { legalNavItems } from "@/components/legal/legal-nav";

// Public, auth-free layout for the legal/trust pages — mirrors app/help/layout.tsx
// so anonymous visitors and search engines can read them without the /customer/*
// role gate. The footer cross-links the four legal pages.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("customer");
  const pathname = usePathname();
  const navItems = legalNavItems(t);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/customer/explore" className="flex items-center gap-2">
            <MyWisataLogo
              markSize={32}
              wordmarkClassName="font-[family-name:var(--font-plus-jakarta-sans)] text-lg font-bold tracking-tight text-foreground"
            />
          </Link>
          <LanguageSwitcher compact className="min-w-0 sm:w-auto" />
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-border bg-card">
        <nav className="mx-auto flex max-w-2xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm sm:px-6">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={active ? "font-semibold text-foreground" : "text-muted-foreground transition-colors hover:text-foreground"}
              >
                {item.label}
              </Link>
            );
          })}
          <Link href="/help" className="text-muted-foreground transition-colors hover:text-foreground">
            {t("legal.nav.help")}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
