export type KycOcrReviewStatus = 'matched' | 'mismatch' | 'unreadable' | 'unavailable';

/** Phase 1: even consistent OCR requires an authorised human decision. */
export function requiresManualKycReview(_status: KycOcrReviewStatus): boolean {
  void _status;
  return true;
}
