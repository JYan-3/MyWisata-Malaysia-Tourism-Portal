import { afterEach, expect, it, vi } from 'vitest';
import { createReviewClock, createBlindReviewPresentation, createReviewStudySummary } from '../lib/kyc-node-ocr-evaluation.mjs';
import { runKycOcr } from '../../lib/kyc/ocr';
vi.mock('../../lib/kyc/node-ocr-engine', () => ({ extractKycFieldsInNode: vi.fn(async () => ({ ok: true, fields: {
  holderName: 'INDEPENDENT PROFILE', documentNumber: '990101140001', expiryDate: null, confidence: 0.99, unreadable: false,
} })) }));
afterEach(() => vi.unstubAllEnvs());
const sample = () => ({ group: 'assisted', stage: 'initial', caseId: 'local-case', reviewCaseGroup: 'local-review',
  documentType: 'national_id', front: { mimeType: 'image/png', bytes: new Uint8Array([1]) }, back: { mimeType: 'image/png', bytes: new Uint8Array([1]) },
  expectedHolderName: 'SECRET GOLD', expectedDocumentNumber: '990101140099', profile: { holderName: 'INDEPENDENT PROFILE', enteredDocumentNumber: '990101140001' } });

it('builds the review hint from the independent profile rather than gold answers', async () => {
  vi.stubEnv('KYC_OCR_ENGINE', 'tesseract-js'); vi.stubEnv('KYC_NODE_OCR_TIMEOUT_MS', '20000');
  const first = await createBlindReviewPresentation(sample(), runKycOcr);
  const second = await createBlindReviewPresentation({ ...sample(), expectedHolderName: 'DIFFERENT SECRET', expectedDocumentNumber: '990101140088' }, runKycOcr);
  expect(first.legalIdentity.fullName).toBe('INDEPENDENT PROFILE');
  expect(first.ocr?.status).toBe('matched');
  expect(first.ocr).toEqual(second.ocr);
  expect(JSON.stringify(first)).not.toMatch(/SECRET GOLD|9901011400|documentNumberHmac|hmacKey/);
  expect(first.assessHint()).toBe('incorrect');
  const mismatch = await createBlindReviewPresentation({ ...sample(), profile: { ...sample().profile, holderName: 'OTHER PROFILE' } }, runKycOcr);
  expect(mismatch.ocr?.status).toBe('mismatch');
});
it('does not reveal gold or run OCR in baseline or missing-profile sessions', async () => {
  const recognize = vi.fn();
  const baseline = await createBlindReviewPresentation({ ...sample(), group: 'baseline' }, recognize);
  expect(baseline.ocr).toBeNull();
  const missing = await createBlindReviewPresentation({ ...sample(), profile: null }, recognize);
  expect(missing.legalIdentity.fullName).toBeNull(); expect(missing.ocr?.status).toBe('unavailable');
  expect(recognize).not.toHaveBeenCalled();
});
it('counts request-info as a step and deduplicates final case completion while retaining aborted effort', () => {
  const summary = createReviewStudySummary();
  summary.record(sample(), { activeMs: 60000, completed: 1, aborted: 0 }, 'request_info', 'incorrect', 20);
  summary.record({ ...sample(), caseId: 'local-resubmission', stage: 'resubmission' }, { activeMs: 30000, completed: 1, aborted: 0 }, 'approve', 'correct', 10);
  summary.record({ ...sample(), caseId: 'local-qa', stage: 'qa' }, { activeMs: 10000, completed: 1, aborted: 0 }, 'approve', 'unmeasured', 0);
  summary.record({ ...sample(), reviewCaseGroup: 'another-review', caseId: 'aborted' }, { activeMs: 20000, completed: 0, aborted: 1 }, null, 'missing', 0);
  const report = summary.report();
  expect(report.groups.assisted).toMatchObject({ assignedCases: 2, terminalCases: 1, activeMs: 120000, abortedSteps: 1, minutesPerTerminalCase: 2, minutesPerAssignedCase: 1 });
  expect(JSON.stringify(report)).not.toMatch(/SECRET|local-case|local-review|another-review|990101/);
});
it('keeps assigned but unstarted cases visible when a session stops early', () => {
  const summary = createReviewStudySummary({ baseline: 0, assisted: 3 });
  summary.record(sample(), { activeMs: 60000, completed: 0, aborted: 1 }, null);
  expect(summary.report().groups.assisted).toMatchObject({ assignedCases: 3, startedCases: 1, unstartedCases: 2, terminalCases: 0, minutesPerTerminalCase: null, minutesPerAssignedCase: 1 / 3 });
});
it('counts active review only and preserves aborted/completed denominators', () => {
  let now = 0;
  const clock = createReviewClock(() => now);
  clock.start(); now = 1000; clock.pause(); now = 9000; clock.start(); now = 10000;
  expect(clock.finish(true)).toEqual({ completed: 1, aborted: 0, activeMs: 2000 });
  expect(clock.finish(false)).toEqual({ completed: 1, aborted: 0, activeMs: 2000 });
  const aborted = createReviewClock(() => now);
  expect(aborted.finish(false)).toEqual({ completed: 0, aborted: 1, activeMs: 0 });
});
