"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { groupByCategory, type HelpArticle } from '@/lib/help/kb';
import { categoryLabel } from '@/components/help/category-label';

// Client-side search over the full (small) article list handed down by the
// server page — no fetch, no API. ponytail: in-memory filter is fine at this
// scale; move to a server search only if the KB grows to hundreds of articles.
export function HelpBrowser({ articles }: { articles: HelpArticle[] }) {
  const { t } = useTranslation('customer');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter((article) =>
      article.title.toLowerCase().includes(q) ||
      article.body.toLowerCase().includes(q) ||
      article.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
    );
  }, [articles, query]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  return (
    <div className="space-y-8">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('help.search.placeholder')}
          className="pl-9"
          aria-label={t('help.search.placeholder')}
        />
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {t('help.search.noResults')}
        </p>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.category}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {categoryLabel(t, group.category)}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {group.articles.map((article) => (
                  <li key={article.id}>
                    <Link
                      href={`/help/${article.slug}`}
                      className="block px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      {article.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
