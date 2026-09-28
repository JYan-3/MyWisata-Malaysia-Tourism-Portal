import type { TFunction } from 'i18next';

// Literal t() calls per category so the i18next extractor/linter can see every
// key statically — a dynamically built key would be invisible to it.
// The keys carry an explicit `customer:` namespace prefix because this helper
// takes `t` as a parameter — without a `useTranslation('customer')` in scope the
// extractor would otherwise attribute them to the default (common) namespace.
// The KB `category` column is a curated lowercase slug; anything unexpected
// falls through to the raw value rather than showing a missing-key warning.
export function categoryLabel(t: TFunction, category: string): string {
  switch (category) {
    case 'rewards': return t('customer:help.categories.rewards');
    case 'wallet': return t('customer:help.categories.wallet');
    case 'booking': return t('customer:help.categories.booking');
    case 'account': return t('customer:help.categories.account');
    case 'affiliate': return t('customer:help.categories.affiliate');
    case 'vendor': return t('customer:help.categories.vendor');
    case 'payment': return t('customer:help.categories.payment');
    case 'general': return t('customer:help.categories.general');
    default: return category;
  }
}
