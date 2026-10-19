/** Respons tiruan endpoint /v8/finance/chart (bentuk mengikuti Yahoo Finance). */

export const DAY = 86400;
/** Senin, 19 Okt 2026 02:00 UTC = 09:00 WIB. Candle harian diberi timestamp 02:00 UTC (09:00 WIB). */
export const MON_19_OCT_0900_WIB = Date.UTC(2026, 9, 19, 2, 0, 0) / 1000;

export interface FixtureOpts {
  /** Timestamp candle terakhir (detik). Default MON_19_OCT_0900_WIB. Candle sebelumnya mundur per hari. */
  lastCandleTs?: number;
  /** regularMarketTime (detik). Default = lastCandleTs + 7 jam (16:00 WIB). */
  marketTime?: number;
  previousClose?: number;
  /** regularMarketPrice. Default = close terakhir. */
  price?: number;
  tradingPeriod?: { start: number; end: number } | null;
  adjClose?: number[] | null;
  dividends?: { ts: number; amount: number }[];
  splits?: { ts: number; numerator: number; denominator: number }[];
}

export function chartFixture(symbol: string, closes: number[], opts: FixtureOpts = {}) {
  const lastTs = opts.lastCandleTs ?? MON_19_OCT_0900_WIB;
  const timestamps = closes.map((_, i) => lastTs - (closes.length - 1 - i) * DAY);
  const last = closes[closes.length - 1];
  const marketTime = opts.marketTime ?? lastTs + 7 * 3600;
  const tp = opts.tradingPeriod === undefined
    ? { start: MON_19_OCT_0900_WIB, end: MON_19_OCT_0900_WIB + 7 * 3600 } // Senin 09:00–16:00 WIB
    : opts.tradingPeriod;

  const result: any = {
    meta: {
      currency: "IDR",
      symbol,
      exchangeTimezoneName: "Asia/Jakarta",
      gmtoffset: 25200,
      regularMarketPrice: opts.price ?? last,
      regularMarketTime: marketTime,
      regularMarketDayHigh: last + 50,
      regularMarketDayLow: last - 50,
      fiftyTwoWeekHigh: 8750,
      fiftyTwoWeekLow: 4820,
      chartPreviousClose: 9999, // sengaja beda: ini penutupan sebelum awal rentang
      ...(opts.previousClose !== undefined ? { previousClose: opts.previousClose } : {}),
      ...(tp ? { currentTradingPeriod: { regular: { ...tp, timezone: "WIB", gmtoffset: 25200 } } } : {}),
    },
    timestamp: timestamps,
    indicators: {
      quote: [
        {
          open: closes,
          high: closes.map((c) => c + 25),
          low: closes.map((c) => c - 25),
          close: closes,
          volume: closes.map(() => 1_000_000),
        },
      ],
      ...(opts.adjClose === null ? {} : { adjclose: [{ adjclose: opts.adjClose ?? closes }] }),
    },
  };
  if (opts.dividends || opts.splits) {
    result.events = {};
    if (opts.dividends) {
      result.events.dividends = Object.fromEntries(opts.dividends.map((d) => [String(d.ts), { amount: d.amount, date: d.ts }]));
    }
    if (opts.splits) {
      result.events.splits = Object.fromEntries(
        opts.splits.map((s) => [String(s.ts), { date: s.ts, numerator: s.numerator, denominator: s.denominator, splitRatio: `${s.numerator}:${s.denominator}` }]),
      );
    }
  }
  return { chart: { result: [result], error: null } };
}

export function notFoundFixture() {
  return { chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } };
}

/**
 * fetch palsu. bodies: simbol -> body JSON, atau fungsi (url) -> body untuk respons berbeda per range.
 * Simbol yang ada di `failing` mengembalikan HTTP 500.
 */
export function fakeFetch(bodies: Record<string, unknown | ((url: string) => unknown)>, failing: string[] = []) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const symbol = decodeURIComponent(url.split("/v8/finance/chart/")[1].split("?")[0]);
    if (failing.includes(symbol)) return new Response("boom", { status: 500, statusText: "Internal Server Error" });
    const entry = bodies[symbol];
    if (!entry) return new Response(JSON.stringify(notFoundFixture()), { status: 404 });
    const body = typeof entry === "function" ? (entry as (u: string) => unknown)(url) : entry;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}
