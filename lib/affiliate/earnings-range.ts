// The earnings period choice ("this month / this year / all time"), shared by
// the on-screen earnings history and the CSV export so both always agree.
// Pure: safe to import from client components (earnings-export.ts is not).

export type EarningsExportRange = 'month' | 'year' | 'all';

/** Start of the period in UTC as an ISO string, or null for all time. */
export function rangeCutoffIso(range: EarningsExportRange, now = new Date()): string | null {
  if (range === 'month') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  }
  if (range === 'year') {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  }
  return null;
}
