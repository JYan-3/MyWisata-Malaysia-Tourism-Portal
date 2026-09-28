// P4 — Member 4: public Help Center — client-safe pure helpers + types.
// The DB reads live in kb.server.ts (they import next/headers via the cookie
// client) so this module can be imported from Client Components too.

import { slugify } from '@/lib/utils';

export interface HelpArticle {
  id: string;
  title: string;
  body: string;
  keywords: string[];
  category: string;
  slug: string;
  createdAt: string;
}

export interface HelpCategory {
  category: string;
  articles: HelpArticle[];
}

export type KbRow = {
  id: string;
  title: string;
  body: string;
  keywords: string[] | null;
  category: string | null;
  created_at: string;
};

const UNCATEGORISED = 'general';

/** URL slug for an article — the title, kebab-cased via the shared helper. */
export function articleSlug(title: string): string {
  return slugify(title);
}

/** A short plain-text preview for cards and meta descriptions. */
export function articleExcerpt(body: string, max = 160): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  // Cut on a word boundary so the excerpt never ends mid-word.
  return `${flat.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

export function toArticle(row: KbRow): HelpArticle {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    keywords: row.keywords ?? [],
    category: row.category ?? UNCATEGORISED,
    slug: articleSlug(row.title),
    createdAt: row.created_at,
  };
}

/** Group a flat article list into per-category buckets, categories sorted A→Z. */
export function groupByCategory(articles: HelpArticle[]): HelpCategory[] {
  const byCategory = new Map<string, HelpArticle[]>();
  for (const article of articles) {
    const list = byCategory.get(article.category) ?? [];
    list.push(article);
    byCategory.set(article.category, list);
  }
  return [...byCategory.entries()]
    .map(([category, list]) => ({ category, articles: list }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
