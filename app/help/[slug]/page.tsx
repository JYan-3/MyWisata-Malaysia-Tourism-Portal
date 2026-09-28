import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, LifeBuoy } from 'lucide-react';
import { getServerTranslation } from '@/lib/i18n/server';
import { getHelpArticleBySlug } from '@/lib/help/kb.server';
import { articleExcerpt } from '@/lib/help/kb';
import { categoryLabel } from '@/components/help/category-label';
import { BRAND_NAME } from '@/lib/i18n/invariant-tokens';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getHelpArticleBySlug(slug);
  if (!article) return { title: `${BRAND_NAME} Help` };
  const title = `${article.title} · ${BRAND_NAME} Help`;
  const description = articleExcerpt(article.body);
  return {
    title,
    description,
    openGraph: { title, description },
  };
}

function paragraphs(body: string): string[] {
  return body.split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

export default async function HelpArticlePage({ params }: Props) {
  const { slug } = await params;
  const { t } = await getServerTranslation('customer');
  const article = await getHelpArticleBySlug(slug);
  if (!article) notFound();

  // FAQPage structured data, emitted only on this page — self-contained, so it
  // adds no dependency on any other member's page metadata.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: article.title,
        acceptedAnswer: { '@type': 'Answer', text: article.body },
      },
    ],
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Link
        href="/help"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('help.backToHelp')}
      </Link>

      <article>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {categoryLabel(t, article.category)}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {article.title}
        </h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-foreground">
          {paragraphs(article.body).map((para, index) => (
            <p key={index}>{para}</p>
          ))}
        </div>

        {article.keywords.length > 0 && (
          <div className="mt-8">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('help.article.topics')}
            </p>
            <ul className="flex flex-wrap gap-2">
              {article.keywords.map((keyword) => (
                <li
                  key={keyword}
                  className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground"
                >
                  {keyword}
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>

      <aside className="mt-10 rounded-lg border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <LifeBuoy className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">{t('help.article.stillNeedHelp')}</p>
            <Link
              href="/customer/support"
              className="mt-2 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              {t('help.article.contactSupport')}
            </Link>
          </div>
        </div>
      </aside>
    </main>
  );
}
