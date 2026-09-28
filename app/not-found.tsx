import Link from 'next/link';
import { getServerTranslation } from '@/lib/i18n/server';
import { MyWisataLogo } from '@/components/shared/mywisata-logo';

// Root 404 — rendered inside the root layout, so i18n + theming are available.
export default async function NotFound() {
  const { t } = await getServerTranslation('common');
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
      <MyWisataLogo markSize={40} wordmarkClassName="sr-only" />
      <p className="mt-6 text-5xl font-bold tracking-tight text-muted-foreground">404</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">{t('appShell.notFound.title')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('appShell.notFound.body')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/customer/explore" className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">
          {t('appShell.notFound.explore')}
        </Link>
        <Link href="/help" className="rounded-full border border-border px-5 py-2 text-sm font-semibold text-foreground">
          {t('appShell.notFound.help')}
        </Link>
      </div>
    </main>
  );
}
