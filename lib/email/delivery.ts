/** A Message-ID correlates attempts; SMTP does not guarantee deduplication. */
export type EmailDelivery = { messageId: string; beforeSend: () => Promise<void> };

export class EmailDeliveryError extends Error {
  constructor(readonly retrySafe: boolean) {
    super(retrySafe ? 'email_delivery_retryable' : 'email_delivery_unknown');
  }
}

export function classifyEmailDeliveryError(error: unknown, attempted: boolean): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) return error;
  const details = error as { code?: string; command?: string; responseCode?: number } | null;
  const rejected = typeof details?.responseCode === 'number' && details.responseCode >= 400 && details.responseCode < 600;
  const beforeData = ['EDNS', 'EAUTH', 'ENOAUTH', 'EENVELOPE'].includes(details?.code ?? '')
    || (details?.command === 'CONN' && ['ECONNECTION', 'ESOCKET', 'ETIMEDOUT'].includes(details?.code ?? ''));
  return new EmailDeliveryError(!attempted || rejected || beforeData);
}

export const emailTransportTimeouts = { connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 60_000 };
