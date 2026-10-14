const DEFAULT_NEXT = "/customer/explore";

export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return DEFAULT_NEXT;
  return value;
}

/** Only admin pages; anything else (or the setup page itself) falls back to the dashboard. */
export function safeAdminNext(value: string | null | undefined): string {
  const next = safeNext(value);
  return /^\/admin(\/|\?|$)/.test(next) && !next.startsWith('/admin/security') ? next : '/admin';
}

export function safeKycReviewNext(value: string | null | undefined): string {
  const next = safeNext(value);
  return next === '/admin/kyc' || /^\/admin\/kyc\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(next)
    ? next : '/admin/kyc';
}
