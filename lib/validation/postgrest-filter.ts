// Helpers for putting user input into Supabase (PostgREST) filters safely.
//
// Supabase sends values separately from SQL, so classic SQL injection is not
// possible. Two related problems remain:
// - .or()/.filter() take a *filter string*. Commas, parentheses and quotes in
//   user text would add extra conditions to it ("filter injection").
// - In like/ilike patterns, % _ and * are wildcards (PostgREST treats * as %), so
//   an exact lookup done with .ilike() can match rows the user should not reach.

const FILTER_SYNTAX = /[%*,()"\\]/g;

/**
 * Search text for a `%term%` pattern inside an .or() filter string. Characters that
 * structure the filter (or act as wildcards) become spaces; result is trimmed and capped.
 */
export function postgrestSearchTerm(value: string | null | undefined, maxLength = 100): string {
  return (value ?? '').replace(FILTER_SYNTAX, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Voucher codes are stored uppercase; mirrors the checkout RPC's upper(trim(code)) match. */
export function normalizeVoucherCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Emails are stored lowercase; use with .eq() for an exact, case-insensitive lookup. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
