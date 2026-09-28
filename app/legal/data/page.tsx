import type { Metadata } from 'next';
import { getServerTranslation } from '@/lib/i18n/server';
import { LegalArticle } from '@/components/legal/legal-article';
import { LEGAL_LAST_UPDATED } from '@/components/legal/legal-nav';
import { BRAND_NAME } from '@/lib/i18n/invariant-tokens';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation('customer');
  const title = `${t('legal.data.title')} · ${BRAND_NAME}`;
  const description = t('legal.data.intro');
  return { title, description, openGraph: { title, description } };
}

export default async function DataAndKycPage() {
  const { t } = await getServerTranslation('customer');
  return (
    <LegalArticle
      title={t('legal.data.title')}
      intro={t('legal.data.intro')}
      updated={t('legal.updated', { date: LEGAL_LAST_UPDATED })}
      sections={[
        { heading: t('legal.data.when.heading'), body: t('legal.data.when.body') },
        { heading: t('legal.data.collect.heading'), body: t('legal.data.collect.body') },
        { heading: t('legal.data.storage.heading'), body: t('legal.data.storage.body') },
        { heading: t('legal.data.access.heading'), body: t('legal.data.access.body') },
        { heading: t('legal.data.retention.heading'), body: t('legal.data.retention.body') },
        { heading: t('legal.data.resubmit.heading'), body: t('legal.data.resubmit.body') },
        { heading: t('legal.data.consent.heading'), body: t('legal.data.consent.body') },
      ]}
    />
  );
}
