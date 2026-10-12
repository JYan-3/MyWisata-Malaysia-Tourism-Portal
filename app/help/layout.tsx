"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { MyWisataLogo } from "@/components/shared/mywisata-logo";
import { CustomerSiteFooter } from "@/components/customer/customer-site-footer";

// Public, auth-free layout for the Help Center — mirrors app/guest/layout.tsx so
// anonymous visitors (and search engines) can browse help without the
// /customer/* role gate.
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("customer");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/help" className="flex items-center gap-2">
            <MyWisataLogo
              markSize={32}
              wordmarkClassName="font-[family-name:var(--font-plus-jakarta-sans)] text-lg font-bold tracking-tight text-foreground"
            />
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher compact className="min-w-0 sm:w-auto" />
            <Link
              href="/customer/explore"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              {t("help.backToExplore")}
            </Link>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <CustomerSiteFooter />
    </div>
  );
}
