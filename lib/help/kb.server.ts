// P4 — Member 4: public Help Center — server-only DB reads.
// Kept separate from kb.ts so the pure helpers/types there stay importable from
// Client Components; this file pulls in the cookie-aware client (next/headers).
//
// chatbot_kb_documents has a public-read RLS policy scoped to is_active = true
// (007_public_read_policies.sql: chatbot_kb_public_read), so the cookie-aware
// client is enough and no auth is required — matching the public /help route.

import { createClient } from '@/lib/supabase/server';
import { toArticle, type HelpArticle, type KbRow } from '@/lib/help/kb';

/**
 * All active help articles, ordered by category then title. The explicit
 * is_active filter is belt-and-braces alongside the RLS policy so this behaves
 * identically if ever called with a service-role client.
 */
export async function getHelpArticles(): Promise<HelpArticle[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('chatbot_kb_documents')
    .select('id, title, body, keywords, category, created_at')
    .eq('is_active', true)
    .order('category')
    .order('title');
  if (error) throw new Error(`Failed to load help articles: ${error.message}`);
  return (data ?? []).map((row) => toArticle(row as KbRow));
}

/**
 * One article by slug, or null. Two titles could in principle slugify to the
 * same value; the earliest-created wins, which is deterministic because
 * getHelpArticles() orders stably and this keeps the first match.
 * ponytail: in-memory scan over all active docs; add an indexed slug column if
 * the KB ever outgrows a few hundred articles.
 */
export async function getHelpArticleBySlug(slug: string): Promise<HelpArticle | null> {
  const articles = await getHelpArticles();
  return articles.find((article) => article.slug === slug) ?? null;
}
