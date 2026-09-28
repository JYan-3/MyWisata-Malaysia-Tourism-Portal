import type { Metadata } from 'next';
import { getServerTranslation } from '@/lib/i18n/server';
import { getHelpArticles } from '@/lib/help/kb.server';
import { BRAND_NAME } from '@/lib/i18n/invariant-tokens';
import { HelpBrowser } from '@/components/help/help-browser';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation('customer');
  const title = `${t('help.meta.title')} · ${BRAND_NAME}`;
  const description = t('help.meta.description');
  return {
    title,
    description,
    openGraph: { title, description },
  };
}

export default async function HelpPage() {
  const { t } = await getServerTranslation('customer');
  const articles = await getHelpArticles();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('help.hero.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('help.hero.subtitle')}</p>
      </header>

      {articles.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {t('help.empty')}
        </p>
      ) : (
        <HelpBrowser articles={articles} />
      )}
    </main>
  );
}
