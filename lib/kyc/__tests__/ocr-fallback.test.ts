import { describe, expect, it } from 'vitest';
import { requiresManualKycReview } from '../ocr-policy';

describe('OCR fallback policy', () => {
  it('keeps AI assistance non-authoritative and routes all Phase 1 results to human review', () => {
    expect(requiresManualKycReview('matched')).toBe(true);
    expect(requiresManualKycReview('mismatch')).toBe(true);
    expect(requiresManualKycReview('unreadable')).toBe(true);
    expect(requiresManualKycReview('unavailable')).toBe(true);
  });
});
