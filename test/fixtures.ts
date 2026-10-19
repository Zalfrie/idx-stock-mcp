/** Respons tiruan endpoint /v8/finance/chart (bentuk mengikuti Yahoo Finance). */
export function chartFixture(symbol: string, closes: number[], opts: { previousClose?: number } = {}) {
  const day = 86400;
  const start = 1_791_000_000; // detik epoch
  const timestamps = closes.map((_, i) => start + i * day);
  const last = closes[closes.length - 1];
  return {
    chart: {
      result: [
        {
          meta: {
            currency: "IDR",
            symbol,
            exchangeTimezoneName: "Asia/Jakarta",
            gmtoffset: 25200,
            regularMarketPrice: last,
            regularMarketTime: timestamps[timestamps.length - 1],
            regularMarketDayHigh: last + 50,
            regularMarketDayLow: last - 50,
            fiftyTwoWeekHigh: 8750,
            fiftyTwoWeekLow: 4820,
            chartPreviousClose: 9999, // sengaja beda: ini penutupan sebelum awal rentang
            ...(opts.previousClose !== undefined ? { previousClose: opts.previousClose } : {}),
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
          },
        },
      ],
      error: null,
    },
  };
}

export function notFoundFixture() {
  return { chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } };
}

/** fetch palsu: map simbol -> body JSON. Mencatat URL yang dipanggil. */
export function fakeFetch(bodies: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const symbol = decodeURIComponent(url.split("/v8/finance/chart/")[1].split("?")[0]);
    const body = bodies[symbol];
    if (!body) return new Response(JSON.stringify(notFoundFixture()), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}
