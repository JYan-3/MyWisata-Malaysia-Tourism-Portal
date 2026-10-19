import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolve: vi.fn(),
  reserveQuota: vi.fn(),
  provider: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }));
vi.mock('@/lib/content-translations/server', () => ({ resolvePublicContentTranslations: mocks.resolve }));
vi.mock('@/lib/rate-limit/ai', () => ({ reserveAiQuota: mocks.reserveQuota }));
vi.mock('@/lib/ai/provider', () => ({ generateAiText: mocks.provider }));

import { POST } from '../route';

function post(body: unknown, origin = 'https://app.test') {
  return new Request('https://app.test/api/customer/content-translations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

describe('POST /api/customer/content-translations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.resolve.mockResolvedValue([{ entityType: 'product', entityId: '08f1967f-8d56-42e6-8135-82786d824e2f', field: 'name', translatedText: null, pending: true }]);
    mocks.reserveQuota.mockResolvedValue(true);
  });

  it('accepts guest cache reads and queues misses without calling the provider', async () => {
    mocks.resolve.mockImplementation(async (_db, _locale, _items, reserveEnqueue) => {
      await reserveEnqueue();
      return [{ entityType: 'product', entityId: '08f1967f-8d56-42e6-8135-82786d824e2f', field: 'name', translatedText: null, pending: true }];
    });
    const response = await POST(post({
      locale: 'zh-CN',
      items: [{
        entityType: 'product',
        entityId: '08f1967f-8d56-42e6-8135-82786d824e2f',
        fields: ['name'],
      }],
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).data.translations[0].pending).toBe(true);
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserveQuota).toHaveBeenCalledWith(expect.any(Request), 'content-translation-enqueue', null, 20);
  });

  it('does not spend enqueue quota on a cache-only read', async () => {
    mocks.resolve.mockResolvedValue([{ entityType: 'product', entityId: '08f1967f-8d56-42e6-8135-82786d824e2f', field: 'name', translatedText: '升旗山', pending: false }]);
    const response = await POST(post({
      locale: 'zh-CN',
      items: [{ entityType: 'product', entityId: '08f1967f-8d56-42e6-8135-82786d824e2f', fields: ['name'] }],
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).data.translations[0].translatedText).toBe('升旗山');
    expect(mocks.reserveQuota).not.toHaveBeenCalled();
  });

  it('rejects caller-supplied source text and unsupported fields', async () => {
    const response = await POST(post({
      locale: 'zh-CN',
      sourceText: 'arbitrary prompt',
      items: [{ entityType: 'review', entityId: '08f1967f-8d56-42e6-8135-82786d824e2f', fields: ['authorName'] }],
    }));

    expect(response.status).toBe(422);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('rejects cross-origin enqueue attempts', async () => {
    const response = await POST(post({ locale: 'en', items: [] }, 'https://attacker.test'));
    expect(response.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
