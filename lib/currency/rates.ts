import "server-only";

import type { ForeignReferenceCurrency, ReferenceCurrency } from "./reference";

const RATE_REVALIDATE_SECONDS = 60 * 60 * 24;
const RATE_ATTEMPT_TIMEOUT_MS = 2_500;
const RATE_FAILURE_COOLDOWN_MS = 30_000;
const RATE_API_URL = "https://api.frankfurter.dev/v2/rates";

type RateFetcherState = {
  inFlight: Map<ForeignReferenceCurrency, Promise<ReferenceRateSnapshot | null>>;
  retryAfter: Map<ForeignReferenceCurrency, number>;
};
const fetcherStates = new WeakMap<typeof fetch, RateFetcherState>();

export type ReferenceRateSnapshot = {
  base: "MYR";
  quote: ForeignReferenceCurrency;
  rate: number;
  date: string;
  provider: "BNM";
};

function isIsoDate(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function normalizeRateRow(value: unknown, currency: ForeignReferenceCurrency): ReferenceRateSnapshot | null {
  if (!value || typeof value !== "object") return null;

  const row = value as Record<string, unknown>;
  if (
    row.base !== "MYR"
    || row.quote !== currency
    || !isIsoDate(row.date)
    || typeof row.rate !== "number"
    || !Number.isFinite(row.rate)
    || row.rate <= 0
  ) {
    return null;
  }

  return {
    base: "MYR",
    quote: currency,
    rate: row.rate,
    date: row.date,
    provider: "BNM",
  };
}

export async function getReferenceRate(
  currency: ReferenceCurrency,
  fetcher: typeof fetch = fetch,
): Promise<ReferenceRateSnapshot | null> {
  if (currency === "MYR") return null;

  let state = fetcherStates.get(fetcher);
  if (!state) {
    state = { inFlight: new Map(), retryAfter: new Map() };
    fetcherStates.set(fetcher, state);
  }
  const existing = state.inFlight.get(currency);
  if (existing) return existing;
  if ((state.retryAfter.get(currency) ?? 0) > Date.now()) return null;

  const quote = currency;
  const url = `${RATE_API_URL}?base=MYR&quotes=${quote}&providers=BNM`;
  const task = (async () => {
    try {
      const response = await fetcher(url, {
        cache: "force-cache",
        next: { revalidate: RATE_REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(RATE_ATTEMPT_TIMEOUT_MS),
      } as RequestInit & { next: { revalidate: number } });
      if (!response.ok) throw new Error("Reference rate provider unavailable");
      const payload: unknown = await response.json();
      const snapshot = Array.isArray(payload) && payload.length === 1 ? normalizeRateRow(payload[0], quote) : null;
      if (!snapshot) throw new Error("Reference rate response invalid");
      state!.retryAfter.delete(currency);
      return snapshot;
    } catch {
      state!.retryAfter.set(currency, Date.now() + RATE_FAILURE_COOLDOWN_MS);
      return null;
    } finally {
      state!.inFlight.delete(currency);
    }
  })();
  state.inFlight.set(currency, task);
  return task;
}
