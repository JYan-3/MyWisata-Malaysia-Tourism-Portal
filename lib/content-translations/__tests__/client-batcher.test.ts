import { describe, expect, it, vi } from 'vitest';
import { createContentTranslationBatcher } from '../client-batcher';

describe('content translation client batcher', () => {
  it('sends sibling card and review fields in one identifier-only request per locale', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          translations: [
            { entityType: 'product', entityId: 'product-1', field: 'name', translatedText: '升旗山', pending: false },
            { entityType: 'product', entityId: 'product-1', field: 'description', translatedText: '沿山步道', pending: true },
            { entityType: 'review', entityId: 'review-1', field: 'body', translatedText: null, pending: true },
          ],
        },
      }),
    });
    const batcher = createContentTranslationBatcher(fetcher);

    const productName = batcher.lookup('product', 'product-1', 'name', 'zh-CN');
    const productDescription = batcher.lookup('product', 'product-1', 'description', 'zh-CN');
    const reviewBody = batcher.lookup('review', 'review-1', 'body', 'zh-CN');
    const result = await Promise.all([productName, productDescription, reviewBody]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/customer/content-translations', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        locale: 'zh-CN',
        items: [
          { entityType: 'product', entityId: 'product-1', fields: ['name', 'description'] },
          { entityType: 'review', entityId: 'review-1', fields: ['body'] },
        ],
      }),
    }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('sourceText');
    expect(result).toEqual([
      { translatedText: '升旗山', pending: false },
      { translatedText: '沿山步道', pending: true },
      { translatedText: null, pending: true },
    ]);
  });

  it('does not let one failed batch reject every mounted text consumer', async () => {
    const batcher = createContentTranslationBatcher(vi.fn().mockRejectedValue(new Error('network')));
    const result = await batcher.lookup('product', 'product-1', 'name', 'ms');
    expect(result).toEqual({ translatedText: null, pending: false });
  });

  it('splits oversized rendered pages into bounded requests', async () => {
    const fetcher = vi.fn().mockImplementation(async (_url, init) => ({
      ok: true,
      json: async () => ({ data: { translations: JSON.parse(init.body).items.flatMap((item: { entityType: string; entityId: string; fields: string[] }) => item.fields.map((field) => ({
        entityType: item.entityType, entityId: item.entityId, field, translatedText: null, pending: true,
      }))) } }),
    }));
    const batcher = createContentTranslationBatcher(fetcher);
    const lookups = Array.from({ length: 41 }, (_, index) => batcher.lookup('review', `review-${index}`, 'body', 'en'));

    const result = await Promise.all(lookups);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const batchSizes = fetcher.mock.calls.map((call) => JSON.parse(call[1].body).items.length);
    expect(batchSizes).toEqual([40, 1]);
    expect(result).toHaveLength(41);
  });
});
