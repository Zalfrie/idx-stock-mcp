import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadPortfolio, normalizeHoldingTicker, valuePortfolio, type MarketData } from "./portfolio.js";
import { summarize } from "./summary.js";
import { VALID_INTERVALS, VALID_RANGES, YahooClient, type Range } from "./yahoo.js";

export { summarize } from "./summary.js";

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

/** Rentang chart terpendek yang mencakup tanggal beli, untuk pengecekan split. */
export function splitCheckRange(buyDate: string | undefined, nowMs: number): Range {
  if (!buyDate) return "5y";
  const days = (nowMs - Date.parse(`${buyDate}T00:00:00Z`)) / 86_400_000;
  if (days <= 360) return "1y";
  if (days <= 5 * 360) return "5y";
  return "max";
}

export function createServer(opts: ServerOptions = {}) {
  const client = opts.client ?? new YahooClient();
  const server = new McpServer({ name: "idx-stock-mcp", version: "1.2.0" });

  const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool(
    "get_quote",
    {
      title: "Harga saham terkini",
      description:
        "Ambil harga terakhir saham Bursa Efek Indonesia (BEI/IDX), perubahan harian, rentang 52 minggu, dan harga per lot (100 lembar). " +
        "Terima kode saham seperti BBCA, BBRI, TLKM, atau indeks IHSG. " +
        "Selalu sampaikan freshnessNote ke pengguna (status pasar & waktu data). " + DISCLAIMER,
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
        "Ambil riwayat harga (OHLC + volume) saham IDX untuk rentang waktu tertentu beserta ringkasan: priceReturnPct (harga saja), " +
        "totalReturnPct (termasuk dividen), dividen & stock split dalam rentang, tertinggi, terendah, max drawdown. " +
        `Maksimal ${MAX_CANDLES} candle terakhir; gunakan interval 1wk/1mo untuk rentang panjang.`,
      inputSchema: {
        ticker: z.string().describe("Kode saham IDX, mis. BBCA"),
        range: z.enum(VALID_RANGES).default("6mo").describe("Rentang waktu"),
        interval: z.enum(VALID_INTERVALS).default("1d").describe("Interval candle"),
      },
      annotations: readOnly,
    },
    async ({ ticker, range, interval }) => {
      try {
        const chart = await client.chart(ticker, range, interval);
        const truncated = chart.candles.length > MAX_CANDLES;
        return json({
          symbol: chart.quote.symbol,
          range,
          interval,
          summary: summarize(chart),
          dataAsOf: chart.quote.dataAsOfLocal,
          truncated,
          candles: truncated ? chart.candles.slice(-MAX_CANDLES) : chart.candles,
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
      description:
        "Bandingkan performa 2–10 saham IDX (dan/atau IHSG) dalam rentang waktu yang sama. Diurutkan berdasarkan totalReturnPct " +
        "(harga + dividen) jika tersedia untuk semua, selain itu priceReturnPct. Sebutkan dasar pengurutan (rankedBy) ke pengguna.",
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
            const chart = await client.chart(t, range, interval);
            const s = summarize(chart);
            if (!s) return { ticker: chart.quote.ticker, error: "Tidak ada data harga dalam rentang ini." };
            const { notes: _notes, ...rest } = s;
            return { ticker: chart.quote.ticker, lastPrice: chart.quote.price, ...rest };
          } catch (e) {
            return { ticker: t.toUpperCase(), error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      const ok = rows.filter((r): r is Extract<(typeof rows)[number], { priceReturnPct: number }> => "priceReturnPct" in r);
      const useTotal = ok.length > 0 && ok.every((r) => r.totalReturnPct !== null);
      const key = (r: any) => (useTotal ? r.totalReturnPct : r.priceReturnPct) ?? -Infinity;
      const ranked = [...rows].sort((a, b) => key(b) - key(a));
      const notes = [
        useTotal
          ? "Diurutkan berdasarkan totalReturnPct (perubahan harga + dividen)."
          : "Diurutkan berdasarkan priceReturnPct (harga saja, tanpa dividen) karena data dividen tidak lengkap.",
      ];
      if (ok.some((r) => r.splitsInRange.length > 0)) notes.push("Ada saham yang melakukan stock split dalam rentang ini.");
      if (rows.length !== ok.length) notes.push("Sebagian saham gagal diambil; lihat field error.");
      return json({ range, interval, rankedBy: useTotal ? "totalReturnPct" : "priceReturnPct", ranked, notes, disclaimer: DISCLAIMER });
    },
  );

  server.registerTool(
    "get_portfolio",
    {
      title: "Nilai portofolio saya",
      description:
        "Baca file portofolio lokal (IDX_PORTFOLIO_PATH) lalu hitung nilai pasar, untung/rugi belum terealisasi per saham dan total, " +
        "serta ESTIMASI hasil bersih jika dijual. Juga mengecek stock split setelah tanggal beli. Hanya membaca — tidak bisa membeli atau menjual. " +
        "WAJIB sampaikan isi 'warnings' ke pengguna bersama angka-angkanya, terutama bila totals.incomplete bernilai true.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      if (!opts.portfolioPath) {
        return fail(new Error("IDX_PORTFOLIO_PATH belum di-set. Lihat README untuk cara mengisi portofolio."));
      }
      try {
        const p = await loadPortfolio(opts.portfolioPath);
        const now = client.clock();

        // buyDate paling awal per ticker menentukan rentang pengecekan split
        const earliestBuy = new Map<string, string | undefined>();
        for (const h of p.holdings) {
          const t = normalizeHoldingTicker(h.ticker);
          const prev = earliestBuy.get(t);
          if (!earliestBuy.has(t)) earliestBuy.set(t, h.buyDate);
          else if (prev && h.buyDate && h.buyDate < prev) earliestBuy.set(t, h.buyDate);
          else if (!h.buyDate) earliestBuy.set(t, undefined); // ada lot tanpa tanggal → cek rentang default
        }

        const market = new Map<string, MarketData>();
        await Promise.all(
          [...earliestBuy.entries()].map(async ([t, buyDate]) => {
            const md: MarketData = { quote: new Error("Harga tidak tersedia") };
            const [quoteRes, splitRes] = await Promise.allSettled([
              client.quote(t),
              client.chart(t, splitCheckRange(buyDate, now), "1mo"),
            ]);
            md.quote = quoteRes.status === "fulfilled" ? quoteRes.value : asError(quoteRes.reason);
            if (splitRes.status === "fulfilled") {
              md.splits = splitRes.value.splits;
              md.splitsCheckedSince = splitRes.value.candles[0]?.date;
            } else {
              md.splits = asError(splitRes.reason);
            }
            market.set(t, md);
          }),
        );

        return json({ ...valuePortfolio(p, market, now), disclaimer: DISCLAIMER });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));
