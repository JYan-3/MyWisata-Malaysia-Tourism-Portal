export const KYC_DOCUMENT_SIDES = ['front', 'back'] as const;
export type KycDocumentSide = (typeof KYC_DOCUMENT_SIDES)[number];

export const KYC_REVIEW_REASON_CODES = [
  'document_unreadable',
  'document_incomplete',
  'document_mismatch',
  'document_expired',
  'document_suspected_tampering',
  'other',
] as const;

export type KycReviewReasonCode = (typeof KYC_REVIEW_REASON_CODES)[number];
export type KycReviewAction = 'reject' | 'request_info';
export const KYC_SECURITY_KINDS = ['purge_failed', 'purge_stalled', 'purge_missed', 'access_volume', 'monitor_test'] as const;
export type KycSecurityKind = typeof KYC_SECURITY_KINDS[number];
export type KycSecurityStatus = {
  monitor: { enabledAt: string; lastCheckedAt: string | null };
  latestRun: { startedAt: string; completedAt: string | null; status: 'running' | 'succeeded' | 'failed'; claimed: number; purged: number; failed: number } | null;
  pendingAlerts: number;
  emailRecipients: number;
  incidents: Array<{ kind: KycSecurityKind; count: number; occurredAt: string; resolvedAt: string | null; deliveryQueued: boolean }>;
};
