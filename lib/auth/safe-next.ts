const DEFAULT_NEXT = "/customer/explore";

export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return DEFAULT_NEXT;
  return value;
}

export function safeKycReviewNext(value: string | null | undefined): string {
  const next = safeNext(value);
  return next === '/admin/kyc' || /^\/admin\/kyc\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(next)
    ? next : '/admin/kyc';
}
