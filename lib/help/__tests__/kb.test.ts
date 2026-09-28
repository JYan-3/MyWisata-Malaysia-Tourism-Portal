import { describe, expect, it } from 'vitest';
import { articleExcerpt, articleSlug, groupByCategory, type HelpArticle } from '@/lib/help/kb';

function article(overrides: Partial<HelpArticle>): HelpArticle {
  return {
    id: 'id',
    title: 'Title',
    body: 'Body',
    keywords: [],
    category: 'general',
    slug: 'title',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('articleSlug', () => {
  it('kebab-cases a title', () => {
    expect(articleSlug('How to book an activity?')).toBe('how-to-book-an-activity');
  });

  it('strips punctuation and collapses whitespace', () => {
    expect(articleSlug('  Refunds & vouchers:  how? ')).toBe('refunds-vouchers-how');
  });
});

describe('articleExcerpt', () => {
  it('returns short bodies unchanged (whitespace flattened)', () => {
    expect(articleExcerpt('Line one.\n\nLine two.')).toBe('Line one. Line two.');
  });

  it('truncates on a word boundary with an ellipsis', () => {
    const body = 'a'.repeat(10) + ' ' + 'b'.repeat(200);
    const out = articleExcerpt(body, 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('b'.repeat(200));
    // never cuts mid-word: the only whole word that fits is the 10 a's
    expect(out).toBe('a'.repeat(10) + '…');
  });
});

describe('groupByCategory', () => {
  it('buckets by category and sorts categories A→Z', () => {
    const groups = groupByCategory([
      article({ id: '1', category: 'wallet' }),
      article({ id: '2', category: 'account' }),
      article({ id: '3', category: 'wallet' }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['account', 'wallet']);
    expect(groups.find((g) => g.category === 'wallet')?.articles.map((a) => a.id)).toEqual(['1', '3']);
  });

  it('returns an empty list for no articles', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
