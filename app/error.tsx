"use client";

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

// Root error boundary — a client component per Next.js. Rendered inside the root
// layout, so i18n + theming are available. global-error.tsx is the last-resort
// fallback for when the root layout itself throws.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useTranslation('common');

  useEffect(() => {
    // Surface the error for debugging; keep the digest for correlating with logs.
    console.error('App error boundary caught:', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('appShell.error.title')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('appShell.error.body')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
        >
          {t('appShell.error.retry')}
        </button>
        <Link href="/" className="rounded-full border border-border px-5 py-2 text-sm font-semibold text-foreground">
          {t('appShell.error.home')}
        </Link>
      </div>
      {error.digest && (
        <p className="mt-6 text-xs text-muted-foreground">
          {t('appShell.error.reference', { digest: error.digest })}
        </p>
      )}
    </main>
  );
}
