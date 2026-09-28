import type { TFunction } from 'i18next';

// Single source of truth for the "last updated" date shown on every legal page.
// Locale-neutral ISO format so it reads correctly in all three languages.
export const LEGAL_LAST_UPDATED = '2026-09-27';

// The four legal routes and their nav labels. Literal `customer:` keys (this
// helper takes `t` as a param, so the extractor can't infer the namespace) — same
// pattern as components/help/category-label.ts.
export interface LegalNavItem {
  href: string;
  label: string;
}

export function legalNavItems(t: TFunction): LegalNavItem[] {
  return [
    { href: '/legal/privacy', label: t('customer:legal.nav.privacy') },
    { href: '/legal/terms', label: t('customer:legal.nav.terms') },
    { href: '/legal/data', label: t('customer:legal.nav.data') },
    { href: '/legal/about', label: t('customer:legal.nav.about') },
  ];
}
