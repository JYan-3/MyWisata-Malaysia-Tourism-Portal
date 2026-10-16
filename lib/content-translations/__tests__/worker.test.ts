import { describe, expect, it, vi } from 'vitest';
import { processClaimedTranslationJob, type TranslationJob } from '../worker';
import { sourceHash } from '@/lib/recommendations/content-localization';

const job: TranslationJob = {
  id: 'job-1', entity_type: 'review', entity_key: 'review-1', field: 'body', locale: 'zh-CN',
  source_hash: sourceHash('A nice visit'), attempts: 1, lease_token: 'lease-1',
};

function dependencies(overrides: Partial<Parameters<typeof processClaimedTranslationJob>[1]> = {}) {
  return {
    loadSource: vi.fn().mockResolvedValue({ entityType: 'review', entityId: 'review-1', field: 'body', sourceText: 'A nice visit' }),
    generate: vi.fn().mockResolvedValue({ available: true, provider: 'qwencloud', model: 'test', content: '愉快的体验' }),
    reserveGlobalBudget: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(true),
    defer: vi.fn().mockResolvedValue(true),
    supersede: vi.fn().mockResolvedValue(true),
    releaseForBudget: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('processClaimedTranslationJob', () => {
  it('never calls the provider if current public source no longer matches the leased hash', async () => {
    const deps = dependencies({ loadSource: vi.fn().mockResolvedValue({ sourceText: 'edited review' }) });
    await processClaimedTranslationJob(job, deps);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.supersede).toHaveBeenCalledOnce();
  });

  it('redacts review PII and rejects provider output that removes redaction placeholders', async () => {
    const deps = dependencies({
      loadSource: vi.fn().mockResolvedValue({ entityType: 'review', entityId: 'review-1', field: 'body', sourceText: 'Call 012-3456789 for details' }),
      generate: vi.fn().mockResolvedValue({ available: true, provider: 'qwencloud', model: 'test', content: '请拨打0123456789' }),
    });
    await processClaimedTranslationJob({ ...job, source_hash: sourceHash('Call 012-3456789 for details') }, deps);
    expect(deps.generate).toHaveBeenCalledWith(expect.objectContaining({ sourceText: expect.stringContaining('[PHONE]') }), expect.any(AbortSignal));
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.defer).toHaveBeenCalledWith(expect.objectContaining({ source_hash: sourceHash('Call 012-3456789 for details') }), 'invalid_translation_output');
  });

  it('translates valid content under the global provider budget and completes against the current hash', async () => {
    const deps = dependencies();
    await processClaimedTranslationJob(job, deps);
    expect(deps.reserveGlobalBudget).toHaveBeenCalledOnce();
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.complete).toHaveBeenCalledWith(job, '愉快的体验', 'qwencloud', 'test');
    expect(deps.defer).not.toHaveBeenCalled();
  });

  it('rechecks visibility and source hash after the provider returns before writing cache', async () => {
    const deps = dependencies({
      loadSource: vi.fn()
        .mockResolvedValueOnce({ entityType: 'review', entityId: 'review-1', field: 'body', sourceText: 'A nice visit' })
        .mockResolvedValueOnce(null),
    });
    await processClaimedTranslationJob(job, deps);
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.supersede).toHaveBeenCalledOnce();
  });

  it('releases a job without consuming an attempt when the global provider budget is exhausted', async () => {
    const deps = dependencies({ reserveGlobalBudget: vi.fn().mockResolvedValue(false) });
    await processClaimedTranslationJob(job, deps);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.releaseForBudget).toHaveBeenCalledOnce();
  });
});
