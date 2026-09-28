import type { Metadata } from 'next';
import { getServerTranslation } from '@/lib/i18n/server';
import { LegalArticle } from '@/components/legal/legal-article';
import { LEGAL_LAST_UPDATED } from '@/components/legal/legal-nav';
import { BRAND_NAME } from '@/lib/i18n/invariant-tokens';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation('customer');
  const title = `${t('legal.terms.title')} · ${BRAND_NAME}`;
  const description = t('legal.terms.intro');
  return { title, description, openGraph: { title, description } };
}

export default async function TermsPage() {
  const { t } = await getServerTranslation('customer');
  return (
    <LegalArticle
      title={t('legal.terms.title')}
      intro={t('legal.terms.intro')}
      updated={t('legal.updated', { date: LEGAL_LAST_UPDATED })}
      sections={[
        { heading: t('legal.terms.prototype.heading'), body: t('legal.terms.prototype.body') },
        { heading: t('legal.terms.accounts.heading'), body: t('legal.terms.accounts.body') },
        { heading: t('legal.terms.acceptableUse.heading'), body: t('legal.terms.acceptableUse.body') },
        { heading: t('legal.terms.payments.heading'), body: t('legal.terms.payments.body') },
        { heading: t('legal.terms.earnings.heading'), body: t('legal.terms.earnings.body') },
        { heading: t('legal.terms.content.heading'), body: t('legal.terms.content.body') },
        { heading: t('legal.terms.liability.heading'), body: t('legal.terms.liability.body') },
        { heading: t('legal.terms.changes.heading'), body: t('legal.terms.changes.body') },
      ]}
    />
  );
}
