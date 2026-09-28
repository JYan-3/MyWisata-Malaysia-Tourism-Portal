import Link from 'next/link';
import { getServerTranslation } from '@/lib/i18n/server';

export default async function HelpArticleNotFound() {
  const { t } = await getServerTranslation('customer');
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-start px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('help.notFound.title')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('help.notFound.body')}</p>
      <Link
        href="/help"
        className="mt-6 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        {t('help.backToHelp')}
      </Link>
    </main>
  );
}
