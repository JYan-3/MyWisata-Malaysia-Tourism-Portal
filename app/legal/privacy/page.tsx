import type { Metadata } from 'next';
import { getServerTranslation } from '@/lib/i18n/server';
import { LegalArticle } from '@/components/legal/legal-article';
import { LEGAL_LAST_UPDATED } from '@/components/legal/legal-nav';
import { BRAND_NAME } from '@/lib/i18n/invariant-tokens';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation('customer');
  const title = `${t('legal.privacy.title')} · ${BRAND_NAME}`;
  const description = t('legal.privacy.intro');
  return { title, description, openGraph: { title, description } };
}

export default async function PrivacyPage() {
  const { t } = await getServerTranslation('customer');
  return (
    <LegalArticle
      title={t('legal.privacy.title')}
      intro={t('legal.privacy.intro')}
      updated={t('legal.updated', { date: LEGAL_LAST_UPDATED })}
      sections={[
        { heading: t('legal.privacy.collect.heading'), body: t('legal.privacy.collect.body') },
        { heading: t('legal.privacy.why.heading'), body: t('legal.privacy.why.body') },
        { heading: t('legal.privacy.cookies.heading'), body: t('legal.privacy.cookies.body') },
        { heading: t('legal.privacy.sharing.heading'), body: t('legal.privacy.sharing.body') },
        { heading: t('legal.privacy.retention.heading'), body: t('legal.privacy.retention.body') },
        { heading: t('legal.privacy.rights.heading'), body: t('legal.privacy.rights.body') },
        { heading: t('legal.privacy.contact.heading'), body: t('legal.privacy.contact.body') },
      ]}
    />
  );
}
