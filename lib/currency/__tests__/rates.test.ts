import { afterEach, describe, expect, it, vi } from "vitest";
import { getReferenceRate } from "../rates";

function response(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("BNM reference rate reader", () => {
  it("does not fetch a rate when MYR is selected", async () => {
    const fetcher = vi.fn();

    await expect(getReferenceRate("MYR", fetcher as typeof fetch)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fetches and normalizes one cached BNM quote", async () => {
    const fetcher = vi.fn().mockResolvedValue(response([
      { date: "2026-09-11", base: "MYR", quote: "USD", rate: 0.24561 },
    ]));

    await expect(getReferenceRate("USD", fetcher as typeof fetch)).resolves.toEqual({
      date: "2026-09-11",
      base: "MYR",
      quote: "USD",
      rate: 0.24561,
      provider: "BNM",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.frankfurter.dev/v2/rates?base=MYR&quotes=USD&providers=BNM",
      expect.objectContaining({
        cache: "force-cache",
        next: { revalidate: 86_400 },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("coalesces concurrent refreshes for the same currency", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const calls = Array.from({ length: 20 }, () => getReferenceRate("SGD", fetcher as typeof fetch));
    finish(response([{ date: "2026-09-21", base: "MYR", quote: "SGD", rate: 0.31289 }]));
    const results = await Promise.all(calls);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result?.rate === 0.31289)).toBe(true);
  });

  it("keeps different currency requests and injected fetchers isolated", async () => {
    const makeFetcher = (usdRate: number, sgdRate = usdRate) => vi.fn((input: RequestInfo | URL) => {
      const quote = String(input).includes("quotes=SGD") ? "SGD" : "USD";
      return Promise.resolve(response([{ date: "2026-09-21", base: "MYR", quote, rate: quote === "SGD" ? sgdRate : usdRate }]));
    });
    const first = makeFetcher(0.24, 0.31);
    const second = makeFetcher(0.25);
    await expect(Promise.all([
      getReferenceRate("USD", first as typeof fetch),
      getReferenceRate("SGD", first as typeof fetch),
      getReferenceRate("USD", second as typeof fetch),
    ])).resolves.toEqual([
      expect.objectContaining({ quote: "USD", rate: 0.24 }),
      expect.objectContaining({ quote: "SGD", rate: 0.31 }),
      expect.objectContaining({ quote: "USD", rate: 0.25 }),
    ]);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("places failed currencies on a 30-second cooldown and recovers afterward", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response([
      { date: "2026-09-21", base: "MYR", quote: "SGD", rate: 0.31289 },
    ]));
    await expect(getReferenceRate("SGD", fetcher as typeof fetch)).resolves.toBeNull();
    await expect(getReferenceRate("SGD", fetcher as typeof fetch)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(getReferenceRate("SGD", fetcher as typeof fetch)).resolves.toMatchObject({ rate: 0.31289 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { body: null, label: "null payload" },
    { body: [], label: "empty payload" },
    { body: [{ date: "not-a-date", base: "MYR", quote: "USD", rate: 0.24 }], label: "invalid date" },
    { body: [{ date: "2026-09-11", base: "EUR", quote: "USD", rate: 0.24 }], label: "wrong base" },
    { body: [{ date: "2026-09-11", base: "MYR", quote: "EUR", rate: 0.24 }], label: "wrong quote" },
    { body: [{ date: "2026-09-11", base: "MYR", quote: "USD", rate: 0 }], label: "zero rate" },
    { body: [{ date: "2026-09-11", base: "MYR", quote: "USD", rate: -1 }], label: "negative rate" },
    { body: [{ date: "2026-09-11", base: "MYR", quote: "USD", rate: "0.24" }], label: "non-numeric rate" },
  ])("fails closed for $label", async ({ body }) => {
    const fetcher = vi.fn().mockResolvedValue(response(body));

    await expect(getReferenceRate("USD", fetcher as typeof fetch)).resolves.toBeNull();
  });

  it("fails closed for provider errors", async () => {
    const rejected = vi.fn().mockRejectedValue(new Error("offline"));
    const httpFailure = vi.fn().mockResolvedValue(response({}, false));

    await expect(getReferenceRate("USD", rejected as typeof fetch)).resolves.toBeNull();
    await expect(getReferenceRate("USD", httpFailure as typeof fetch)).resolves.toBeNull();
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(httpFailure).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => vi.useRealTimers());
