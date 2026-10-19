/**
 * Klien data harga saham IDX via endpoint chart Yahoo Finance.
 * Saham BEI memakai akhiran ".JK" (contoh: BBCA.JK). IHSG = ^JKSE.
 *
 * Catatan: endpoint ini tidak resmi dan bisa berubah sewaktu-waktu.
 * Pastikan penggunaan sesuai ketentuan layanan Yahoo.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Candle {
  date: string; // YYYY-MM-DD (zona waktu bursa)
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface Quote {
  symbol: string;
  ticker: string; // tanpa akhiran .JK
  currency: string;
  exchangeTimezone: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketTime: string | null; // ISO
  pricePerLot: number; // 1 lot = 100 lembar
}

export interface ChartResult {
  quote: Quote;
  candles: Candle[];
}

export const LOT_SIZE = 100;

export const VALID_RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"] as const;
export const VALID_INTERVALS = ["1d", "1wk", "1mo"] as const;
export type Range = (typeof VALID_RANGES)[number];
export type Interval = (typeof VALID_INTERVALS)[number];

const INDEX_ALIASES: Record<string, string> = {
  IHSG: "^JKSE",
  JKSE: "^JKSE",
  COMPOSITE: "^JKSE",
  LQ45: "^JKLQ45",
};

/** Ubah input pengguna ("bbca", "BBCA.JK", "IHSG") menjadi simbol Yahoo. */
export function normalizeTicker(input: string): string {
  const raw = input.trim().toUpperCase();
  if (!raw) throw new Error("Ticker tidak boleh kosong");
  if (INDEX_ALIASES[raw]) return INDEX_ALIASES[raw];
  if (raw.startsWith("^")) return raw;
  if (raw.endsWith(".JK")) {
    assertTickerShape(raw.slice(0, -3));
    return raw;
  }
  assertTickerShape(raw);
  return `${raw}.JK`;
}

function assertTickerShape(code: string) {
  if (!/^[A-Z0-9-]{2,8}$/.test(code)) {
    throw new Error(`Ticker tidak valid: "${code}". Contoh yang benar: BBCA, BBRI, TLKM`);
  }
}

function stripSuffix(symbol: string): string {
  return symbol.endsWith(".JK") ? symbol.slice(0, -3) : symbol;
}

function toDateString(epochSec: number, gmtOffsetSec: number): string {
  return new Date((epochSec + gmtOffsetSec) * 1000).toISOString().slice(0, 10);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Parse respons JSON /v8/finance/chart menjadi struktur yang rapi. */
export function parseChart(json: any): ChartResult {
  const err = json?.chart?.error;
  if (err) throw new Error(`Yahoo Finance: ${err.description ?? err.code ?? "error tidak diketahui"}`);
  const result = json?.chart?.result?.[0];
  if (!result?.meta) throw new Error("Data tidak ditemukan. Periksa kembali kode saham.");

  const meta = result.meta;
  const gmtOffset: number = num(meta.gmtoffset) ?? 7 * 3600;
  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};

  const candles: Candle[] = timestamps.map((t, i) => ({
    date: toDateString(t, gmtOffset),
    open: num(q.open?.[i]),
    high: num(q.high?.[i]),
    low: num(q.low?.[i]),
    close: num(q.close?.[i]),
    volume: num(q.volume?.[i]),
  }));

  const price = num(meta.regularMarketPrice) ?? [...candles].reverse().find((c) => c.close !== null)?.close ?? null;
  if (price === null) throw new Error("Harga terakhir tidak tersedia untuk simbol ini.");

  // chartPreviousClose = penutupan SEBELUM awal rentang (bukan kemarin), jadi
  // utamakan meta.previousClose, lalu penutupan candle sebelum candle terakhir.
  const withClose = candles.filter((c) => c.close !== null);
  const prevCandleClose = withClose.length >= 2 ? withClose[withClose.length - 2].close : null;
  const previousClose = num(meta.previousClose) ?? prevCandleClose ?? num(meta.chartPreviousClose);
  const change = previousClose !== null ? round(price - previousClose) : null;
  const changePct = previousClose ? round(((price - previousClose) / previousClose) * 100) : null;
  const marketTime = num(meta.regularMarketTime);

  return {
    quote: {
      symbol: meta.symbol,
      ticker: stripSuffix(meta.symbol),
      currency: meta.currency ?? "IDR",
      exchangeTimezone: meta.exchangeTimezoneName ?? "Asia/Jakarta",
      price,
      previousClose,
      change,
      changePct,
      dayHigh: num(meta.regularMarketDayHigh),
      dayLow: num(meta.regularMarketDayLow),
      fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow),
      marketTime: marketTime !== null ? new Date(marketTime * 1000).toISOString() : null,
      pricePerLot: price * LOT_SIZE,
    },
    candles,
  };
}

export interface YahooClientOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export class YahooClient {
  private fetchImpl: FetchLike;
  private baseUrl: string;
  private timeoutMs: number;
  private cacheTtlMs: number;
  private cache = new Map<string, { at: number; data: ChartResult }>();

  constructor(opts: YahooClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = opts.baseUrl ?? "https://query1.finance.yahoo.com";
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.cacheTtlMs = opts.cacheTtlMs ?? 60_000;
  }

  async chart(tickerInput: string, range: Range = "5d", interval: Interval = "1d"): Promise<ChartResult> {
    const symbol = normalizeTicker(tickerInput);
    const key = `${symbol}|${range}|${interval}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.data;

    const url = `${this.baseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    const res = await this.fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (idx-stock-mcp)", Accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 404) throw new Error(`Saham "${tickerInput}" tidak ditemukan.`);
    if (!res.ok) throw new Error(`Gagal mengambil data (${res.status} ${res.statusText}).`);

    const data = parseChart(await res.json());
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  async quote(tickerInput: string): Promise<Quote> {
    return (await this.chart(tickerInput, "5d", "1d")).quote;
  }
}
