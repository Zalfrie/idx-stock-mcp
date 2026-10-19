import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadPortfolio, valuePortfolio } from "./portfolio.js";
import { VALID_INTERVALS, VALID_RANGES, YahooClient, type Candle, type Quote } from "./yahoo.js";

export interface ServerOptions {
  client?: YahooClient;
  portfolioPath?: string;
}

const MAX_CANDLES = 300;
const DISCLAIMER = "Data untuk informasi, bukan rekomendasi beli/jual. Harga bisa tertunda dari bursa.";

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
});

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Ringkasan performa dari deret candle. */
export function summarize(candles: Candle[]) {
  const closes = candles.filter((c) => c.close !== null) as (Candle & { close: number })[];
  if (closes.length === 0) return null;
  const first = closes[0], last = closes[closes.length - 1];
  let high = -Infinity, low = Infinity, peak = -Infinity, maxDrawdown = 0;
  for (const c of closes) {
    high = Math.max(high, c.high ?? c.close);
    low = Math.min(low, c.low ?? c.close);
    peak = Math.max(peak, c.close);
    maxDrawdown = Math.min(maxDrawdown, (c.close - peak) / peak);
  }
  return {
    from: first.date,
    to: last.date,
    startClose: first.close,
    endClose: last.close,
    returnPct: round(((last.close - first.close) / first.close) * 100),
    high,
    low,
    maxDrawdownPct: round(maxDrawdown * 100),
    tradingDays: closes.length,
  };
}

export function createServer(opts: ServerOptions = {}) {
  const client = opts.client ?? new YahooClient();
  const server = new McpServer({ name: "idx-stock-mcp", version: "1.0.0" });

  const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool(
    "get_quote",
    {
      title: "Harga saham terkini",
      description:
        "Ambil harga terakhir saham Bursa Efek Indonesia (BEI/IDX), perubahan harian, rentang 52 minggu, dan harga per lot (100 lembar). " +
        "Terima kode saham seperti BBCA, BBRI, TLKM, atau indeks IHSG. " + DISCLAIMER,
      inputSchema: { ticker: z.string().describe("Kode saham IDX, mis. BBCA atau IHSG") },
      annotations: readOnly,
    },
    async ({ ticker }) => {
      try {
        return json({ ...(await client.quote(ticker)), disclaimer: DISCLAIMER });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_history",
    {
      title: "Riwayat harga saham",
      description:
        "Ambil riwayat harga (OHLC + volume) saham IDX untuk rentang waktu tertentu beserta ringkasan performa " +
        `(return %, tertinggi, terendah, max drawdown). Maksimal ${MAX_CANDLES} candle terakhir; gunakan interval 1wk/1mo untuk rentang panjang.`,
      inputSchema: {
        ticker: z.string().describe("Kode saham IDX, mis. BBCA"),
        range: z.enum(VALID_RANGES).default("6mo").describe("Rentang waktu"),
        interval: z.enum(VALID_INTERVALS).default("1d").describe("Interval candle"),
      },
      annotations: readOnly,
    },
    async ({ ticker, range, interval }) => {
      try {
        const { quote, candles } = await client.chart(ticker, range, interval);
        const truncated = candles.length > MAX_CANDLES;
        return json({
          symbol: quote.symbol,
          range,
          interval,
          summary: summarize(candles),
          truncated,
          candles: truncated ? candles.slice(-MAX_CANDLES) : candles,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "compare_stocks",
    {
      title: "Bandingkan saham",
      description: "Bandingkan performa 2–10 saham IDX (dan/atau IHSG) dalam rentang waktu yang sama: return %, tertinggi, terendah, max drawdown, harga terakhir.",
      inputSchema: {
        tickers: z.array(z.string()).min(2).max(10).describe("Daftar kode saham, mis. [\"BBCA\",\"BBRI\",\"IHSG\"]"),
        range: z.enum(VALID_RANGES).default("6mo"),
      },
      annotations: readOnly,
    },
    async ({ tickers, range }) => {
      const interval = ["2y", "5y", "10y", "max"].includes(range) ? "1wk" : "1d";
      const rows = await Promise.all(
        tickers.map(async (t) => {
          try {
            const { quote, candles } = await client.chart(t, range, interval);
            return { ticker: quote.ticker, lastPrice: quote.price, ...summarize(candles) };
          } catch (e) {
            return { ticker: t.toUpperCase(), error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      const ranked = [...rows].sort((a: any, b: any) => (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity));
      return json({ range, interval, ranked, disclaimer: DISCLAIMER });
    },
  );

  server.registerTool(
    "get_portfolio",
    {
      title: "Nilai portofolio saya",
      description:
        "Baca file portofolio lokal (IDX_PORTFOLIO_PATH) lalu hitung nilai pasar, untung/rugi belum terealisasi per saham dan total, " +
        "serta estimasi hasil bersih jika dijual (setelah fee jual). Hanya membaca — tidak bisa membeli atau menjual.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      if (!opts.portfolioPath) {
        return fail(new Error("IDX_PORTFOLIO_PATH belum di-set. Lihat README untuk cara mengisi portofolio."));
      }
      try {
        const p = await loadPortfolio(opts.portfolioPath);
        const tickers = [...new Set(p.holdings.map((h) => h.ticker.trim().toUpperCase().replace(/\.JK$/, "")))];
        const quotes = new Map<string, Quote | Error>();
        await Promise.all(
          tickers.map(async (t) => {
            try {
              quotes.set(t, await client.quote(t));
            } catch (e) {
              quotes.set(t, e instanceof Error ? e : new Error(String(e)));
            }
          }),
        );
        return json({ ...valuePortfolio(p, quotes), disclaimer: DISCLAIMER });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
