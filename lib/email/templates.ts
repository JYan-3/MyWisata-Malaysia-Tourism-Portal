import type { AppLocale } from '@/lib/i18n/locale';
import { emailCopy, emailLocale, emailReason, emailSubject, emailTime, eventFieldLabel, securityDescription, type EventEmailReasonCode } from './copy';
import { formatMYR } from '@/lib/i18n/format';
import { KYC_SECURITY_KINDS, type KycSecurityKind } from '@/lib/kyc/types';
import { resolvePaymentAppUrl } from '@/lib/payments/app-url';

export type KycSecurityEmailInput = {
  locale?: AppLocale;
  eventType: 'kyc_security_alert';
  kind: KycSecurityKind;
  count: number;
  occurredAt: string;
  recipientName?: string | null;
};

/** Only fixed incident copy and numeric aggregates may enter security mail. */
export function renderKycSecurityEmail(input: KycSecurityEmailInput): RenderedEmail {
  if (!KYC_SECURITY_KINDS.includes(input.kind) || !Number.isSafeInteger(input.count) || input.count < 0 || !Number.isFinite(Date.parse(input.occurredAt))) {
    throw new Error('Invalid KYC security alert');
  }
  const copy = emailCopy(input.locale);
  return renderSystemEmail(input.locale, copy.security, [
    securityDescription(input.kind, input.locale), `${copy.count}: ${input.count}`,
    `${copy.time}: ${emailTime(input.occurredAt, input.locale)} (${copy.malaysiaTime})`, copy.securityGuidance,
  ], { label: copy.reviewSecurity, url: `${resolvePaymentAppUrl()}/admin/kyc` });
}

export type TransactionEmailType =
  | 'checkout_succeeded'
  | 'order_refunded'
  | 'topup_succeeded'
  | 'topup_failed'
  | 'topup_refunded'
  | 'withdrawal_submitted'
  | 'withdrawal_approved'
  | 'withdrawal_hold'
  | 'withdrawal_resumed'
  | 'withdrawal_paid'
  | 'withdrawal_failed'
  | 'withdrawal_rejected'
  | 'wallet_adjustment'
  | 'payout_account_connected'
  | 'payout_account_disconnected'
  | 'recommendation_reward_pending'
  | 'recommendation_reward_available'
  | 'recommendation_reward_reversed';

export type AccountEmailType =
  | 'account_suspended'
  | 'account_unsuspended'
  | 'account_deleted'
  | 'account_restored';

export type VendorEmailType =
  | 'vendor_order_update'
  | 'vendor_booking_update'
  | 'vendor_listing_review'
  | 'vendor_wallet_update'
  | 'vendor_account_update'
  | 'vendor_permission_update'
  | 'vendor_event_update';

export type EventVendorChange = {
  kind?: 'approval' | 'arrangement';
  eventTitle: string;
  locationName: string;
  startsOn: string;
  endsOn: string;
  changes: Array<{
    field: 'stallNumber' | 'name' | 'address' | 'mapPin' | 'startsOn' | 'endsOn' | 'opensAt' | 'closesAt' | 'applicationsOpen' | 'applicationsCloseAt' | 'approvalsCloseAt' | 'setupStartsAt';
    before: string;
    after: string;
  }>;
  reason: string;
  actionPath: '/vendor/events';
};

export type RecommendationEmailType = 'recommendation_approved';

export type TransactionEmailInput = {
  locale?: AppLocale;
  eventType: TransactionEmailType;
  recipientName?: string | null;
  amountRm: number;
  reference: string;
  occurredAt: string;
  reason?: string;
  accessUrl?: string;
};

export type AccountEmailInput = {
  locale?: AppLocale;
  eventType: AccountEmailType;
  recipientName?: string | null;
  reason: string;
  occurredAt: string;
};

export type VendorEmailInput = {
  locale?: AppLocale;
  eventType: VendorEmailType;
  recipientName?: string | null;
  vendorName: string;
  reason: string;
  reasonCode?: EventEmailReasonCode;
  reasonDetails?: string;
  reference?: string | null;
  occurredAt: string;
  eventChange?: EventVendorChange;
  actionUrl?: string;
};

export type RecommendationEmailInput = {
  locale?: AppLocale;
  eventType: RecommendationEmailType;
  recipientName?: string | null;
  vendorName: string;
  occurredAt: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character);
}

// Notification reasons and references may be assembled from provider metadata.
// Keep provider object IDs and key/value secrets out of email content while
// preserving a useful, human-readable explanation for the recipient.
function sanitizeVendorText(value: string): string {
  return value
    // Redact labelled financial, identity, contact, and location values while
    // retaining the label so the notification remains understandable.
    .replace(/\b(bank\s+account|account(?:\s+(?:number|no))?|card(?:\s+(?:number|no))?|iban|identity(?:\s+(?:card|number|no))?|passport|my\s*kad|mykad|ic|dob|date\s+of\s+birth|email|e-mail|phone|mobile|address)\s*[:=#-]\s*([^,;\n|]+)/gi, '$1: [redacted]')
    // Provider object IDs and secrets must never be exposed in email content.
    .replace(/\b(?:sk|rk|pk|pi|ch|cs|re|cus|acct|pm|src|tok|seti|price|prod|sub|in|ca|evt|whsec)_[A-Za-z0-9_-]+\b/gi, '[redacted]')
    .replace(/\b(?:password|pass|token|secret|auth)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    // Defence in depth for unlabelled email addresses and Malaysian ICs.
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted]')
    .replace(/\b\d{6}-?\d{2}-?\d{4}\b/g, '[redacted]')
    // Unlabelled phone, IBAN, passport, and payment/account-like values.
    .replace(/\+\d{1,3}(?:[\s().-]*\d){7,14}/g, '[redacted]')
    .replace(/(?:\(\s*0\d{1,2}\s*\)|\b0\d{1,2})(?:[\s.-]?\d){7,9}/g, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 9 && digits.length <= 11 ? '[redacted]' : match;
    })
    .replace(/\b[A-Z]{2}\s*\d{2}(?:[\s-]*[A-Z0-9]){11,30}\b/gi, (match) => {
      const normalized = match.replace(/[\s-]/g, '');
      const digitCount = (normalized.match(/\d/g) ?? []).length;
      return normalized.length >= 15 && normalized.length <= 34 && digitCount >= 6 ? '[redacted]' : match;
    })
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi, (match) => {
      const digitCount = (match.match(/\d/g) ?? []).length;
      return digitCount >= 6 ? '[redacted]' : match;
    })
    .replace(/\b[A-Z]{1,2}[\s-]?\d{6,9}\b/gi, '[redacted]')
    .replace(/(?<!\d)(?:\d[\d -]?){12,18}\d(?!\d)/g, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 ? '[redacted]' : match;
    });
}

/** Escape data only at the HTML boundary; the plain-text alternative stays readable. */
function renderSystemEmail(locale: AppLocale | undefined, subject: string, lines: string[], action?: { label: string; url: string; note?: string }): RenderedEmail {
  return {
    subject,
    text: [subject, ...lines, ...(action ? [`${action.label}: ${action.url}`, action.note ?? ''] : [])].filter(Boolean).join('\n'),
    html: `<!doctype html><html lang="${emailLocale(locale)}"><body style="font-family:Arial,sans-serif;color:#183b35;line-height:1.5"><h2>${escapeHtml(subject)}</h2>${lines.filter(Boolean).map(line => `<p>${escapeHtml(line)}</p>`).join('')}${action ? `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a>${action.note ? ` — ${escapeHtml(action.note)}` : ''}</p>` : ''}</body></html>`,
  };
}

function greeting(input: { locale?: AppLocale; recipientName?: string | null }): string {
  const copy = emailCopy(input.locale);
  return `${copy.greeting} ${input.recipientName?.trim() || copy.there},`;
}

export function renderTransactionEmail(input: TransactionEmailInput): RenderedEmail {
  const copy = emailCopy(input.locale);
  const reason = emailReason(input.reason?.trim() || '', input.locale);
  return renderSystemEmail(input.locale, emailSubject(input.eventType, input.locale), [
    greeting(input), copy.transaction, `${copy.amount}: ${formatMYR(input.amountRm)}`,
    `${copy.reference}: ${input.reference.trim()}`, `${copy.time}: ${emailTime(input.occurredAt, input.locale)} (${copy.malaysiaTime})`,
    reason ? `${copy.reason}: ${reason}` : '', copy.automated,
  ], input.accessUrl ? { label: copy.viewOrder, url: input.accessUrl, note: copy.privateLink } : undefined);
}

export function renderAccountEmail(input: AccountEmailInput): RenderedEmail {
  const copy = emailCopy(input.locale);
  return renderSystemEmail(input.locale, emailSubject(input.eventType, input.locale), [
    greeting(input), copy.account, `${copy.reason}: ${emailReason(input.reason.trim(), input.locale)}`,
    `${copy.time}: ${emailTime(input.occurredAt, input.locale)} (${copy.malaysiaTime})`, copy.support,
  ]);
}

export function renderRecommendationEmail(input: RecommendationEmailInput): RenderedEmail {
  const copy = emailCopy(input.locale);
  return renderSystemEmail(input.locale, emailSubject(input.eventType, input.locale), [
    greeting(input), `${copy.recommendation}: ${sanitizeVendorText(input.vendorName.trim())}`, copy.recommended,
    copy.reachOut, `${copy.time}: ${emailTime(input.occurredAt, input.locale)} (${copy.malaysiaTime})`, copy.viewRecommendations,
  ]);
}

export function renderVendorEmail(input: VendorEmailInput): RenderedEmail {
  if (input.eventType === 'vendor_event_update') return renderEventVendorEmail(input);
  const copy = emailCopy(input.locale);
  const vendorName = sanitizeVendorText(input.vendorName.trim());
  const reason = sanitizeVendorText(emailReason(input.reason.trim(), input.locale, input.reasonCode, input.reasonDetails));
  const reference = input.reference ? sanitizeVendorText(input.reference.trim()) : '';
  // Only server-owned Vendor Portal paths may become actionable email links.
  let actionUrl = '';
  if (input.actionUrl) {
    try {
      const url = new URL(input.actionUrl);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
        && ['/vendor/orders', '/vendor/wallet'].includes(url.pathname) && !url.search && !url.hash) actionUrl = url.href;
    } catch { /* Invalid links remain non-actionable. */ }
  }
  return renderSystemEmail(input.locale, emailSubject(input.eventType, input.locale), [
    greeting(input), `${copy.vendorUpdate} ${vendorName}.`, `${copy.vendor}: ${vendorName}`,
    `${copy.reason}: ${reason}`, reference ? `${copy.reference}: ${reference}` : '',
    `${copy.time}: ${emailTime(input.occurredAt, input.locale)} (${copy.malaysiaTime})`, copy.automated,
  ], actionUrl ? { label: copy.viewVendor, url: actionUrl } : undefined);
}

function renderEventVendorEmail(input: VendorEmailInput): RenderedEmail {
  const change = input.eventChange;
  if (!change) throw new Error('Event change details are required');
  // Venue addresses are operational data, not provider metadata to redact.
  const clean = (value: string) => value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[redacted]')
    .replace(/\b(?:sk|rk|pk|pi|ch|cs|cus|acct|tok|whsec)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/(?:https?:\/\/\S+\/storage\/\S+|(?:\/Users\/|\/var\/|\/tmp\/)\S+)/gi, '[redacted]')
    .replace(/\b(?:password|token|secret|auth)\s*[:=]\s*[^\s,;]+/gi, '[redacted]');
  const copy = emailCopy(input.locale);
  const display = (value: string, field: string) => {
    if (field === 'applicationsOpen' && ['true', 'false'].includes(value)) return value === 'true' ? copy.yes : copy.no;
    return clean(value || (input.locale ? copy.notSet : ''));
  };
  const actionUrl = input.actionUrl || '/vendor/events';
  return renderSystemEmail(input.locale, change.kind === 'approval' ? copy.approval : emailSubject('vendor_event_update', input.locale), [
    clean(greeting(input)), `${copy.vendor}: ${clean(input.vendorName)}`, `${copy.event}: ${clean(change.eventTitle)}`,
    `${copy.venue}: ${clean(change.locationName)}`, `${copy.dates}: ${clean(change.startsOn)} – ${clean(change.endsOn)}`,
    ...change.changes.map(item => `${eventFieldLabel(item.field, input.locale)}: ${display(item.before, item.field)} → ${display(item.after, item.field)}`),
    `${copy.reason}: ${clean(emailReason(change.reason, input.locale))}`, `${copy.arrangements}: ${actionUrl}`,
  ], { label: copy.viewEvent, url: actionUrl });
}
