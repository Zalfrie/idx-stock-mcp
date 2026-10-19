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
  /** Harga penutupan yang disesuaikan dividen & split (null jika tidak tersedia). */
  adjClose: number | null;
  volume: number | null;
}

export interface Dividend {
  date: string;
  amount: number; // per lembar
}

export interface Split {
  date: string;
  numerator: number;
  denominator: number;
  ratio: string; // mis. "5:1" = 1 lembar lama jadi 5 lembar baru
}

export type MarketState = "open" | "closed" | "unknown";

export interface Quote {
  symbol: string;
  ticker: string; // tanpa akhiran .JK
  currency: string;
  exchangeTimezone: string;
  price: number;
  previousClose: number | null;
  /** Dari mana previousClose diambil — untuk audit. */
  previousCloseSource: "meta.previousClose" | "candle" | "unavailable";
  change: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** Harga 1 lot (100 lembar). null untuk indeks, karena indeks tidak diperdagangkan per lot. */
  pricePerLot: number | null;
  /** Waktu harga terakhir (ISO, UTC). */
  dataAsOf: string | null;
  /** Waktu harga terakhir dalam WIB, mudah dibaca. */
  dataAsOfLocal: string | null;
  dataAgeMinutes: number | null;
  marketState: MarketState;
  /** Penjelasan singkat soal kesegaran data, untuk disampaikan ke pengguna. */
  freshnessNote: string;
}

export interface ChartResult {
  quote: Quote;
  candles: Candle[];
  dividends: Dividend[];
  splits: Split[];
}

export const LOT_SIZE = 100;
/** Jika pasar dianggap buka tapi harga tidak bergerak selama ini, tandai mencurigakan. */
export const STALE_WHILE_OPEN_MINUTES = 30;

export const VALID_RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"] as const;
export const VALID_INTERVALS = ["1d", "1wk", "1mo"] as const;
export type Range = (typeof VALID_RANGES)[number];
export type Interval = (typeof VALID_INTERVALS)[number];

const INDEX_ALIASES: Record<string, string> = {
  IHSG: "^JKSE",
  JKSE: "^JKSE",
  COMPOSITE: "^JKSE",
};

/** Ubah input pengguna ("bbca", "BBCA.JK", "IHSG") menjadi simbol Yahoo. */
export function normalizeTicker(input: string): string {
  const raw = input.trim().toUpperCase();
  if (!raw) throw new Error("Ticker tidak boleh kosong");
  if (INDEX_ALIASES[raw]) return INDEX_ALIASES[raw];
  if (raw.startsWith("^")) {
    if (!/^\^[A-Z0-9]{2,10}$/.test(raw)) throw new Error(`Simbol indeks tidak valid: "${raw}"`);
    return raw;
  }
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

/** Tanggal (YYYY-MM-DD) di zona waktu bursa. */
function toDateString(epochSec: number, gmtOffsetSec: number): string {
  return new Date((epochSec + gmtOffsetSec) * 1000).toISOString().slice(0, 10);
}

const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "Jum, 16 Okt 2026 16:14 WIB" — tanpa bergantung pada data locale ICU. */
function formatLocal(epochSec: number, gmtOffsetSec: number, tzLabel: string): string {
  const d = new Date((epochSec + gmtOffsetSec) * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} ${tzLabel}`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export interface ParseOptions {
  /** Waktu sekarang (ms epoch). Bisa diisi untuk test. */
  now?: number;
}

/**
 * Tentukan status pasar.
 * Prioritas: meta.currentTradingPeriod.regular dari Yahoo; jika tidak ada, perkiraan
 * jam bursa BEI (Senin–Jumat 09:00–16:00 WIB, tanpa memperhitungkan hari libur).
 */
function detectMarketState(meta: any, nowSec: number, gmtOffset: number): MarketState {
  const reg = meta?.currentTradingPeriod?.regular;
  const start = num(reg?.start), end = num(reg?.end);
  if (start !== null && end !== null && end > start) {
    return nowSec >= start && nowSec < end ? "open" : "closed";
  }
  const local = new Date((nowSec + gmtOffset) * 1000);
  const day = local.getUTCDay();
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (day === 0 || day === 6) return "closed";
  if (minutes < 9 * 60 || minutes >= 16 * 60) return "closed";
  return "unknown"; // jam bursa, tapi tanpa data resmi tidak bisa memastikan (bisa hari libur)
}

/**
 * Jeda siang BEI (zona waktu bursa): Senin–Kamis 12:00–13:30, Jumat 11:30–14:00.
 * Sumber: Peraturan BEI Nomor II-A (Kep-00157/BEI/10-2026), halaman "Jam dan Mekanisme Perdagangan" idx.co.id,
 * diverifikasi 19 Okt 2026. Jika BEI mengubah jadwal, cukup sesuaikan angka di fungsi ini.
 * Yahoo melaporkan jam reguler 09:00–16:15 tanpa jeda, jadi harus dicek sendiri.
 * Mengembalikan jam pembukaan sesi 2 ("HH:MM") bila sedang jeda, selain itu null.
 */
function lunchBreakResumeAt(nowSec: number, gmtOffset: number): string | null {
  const local = new Date((nowSec + gmtOffset) * 1000);
  const day = local.getUTCDay();
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (day === 5) return minutes >= 11 * 60 + 30 && minutes < 14 * 60 ? "14:00" : null;
  if (day >= 1 && day <= 4) return minutes >= 12 * 60 && minutes < 13 * 60 + 30 ? "13:30" : null;
  return null;
}

function buildFreshnessNote(
  state: MarketState,
  local: string | null,
  ageMin: number | null,
  lunchResumeAt: string | null,
  tzLabel: string,
): string {
  if (!local) return "Waktu data tidak tersedia; perlakukan harga sebagai perkiraan.";
  if (state === "closed") return `Pasar sedang tutup. Harga adalah penutupan terakhir per ${local}.`;
  if (state === "open") {
    if (lunchResumeAt) {
      return `Pasar sedang jeda siang; harga terakhir per ${local} adalah penutupan sesi 1. Sesi 2 dibuka pukul ${lunchResumeAt} ${tzLabel}.`;
    }
    if (ageMin !== null && ageMin > STALE_WHILE_OPEN_MINUTES) {
      return `Pasar seharusnya buka, tetapi harga terakhir per ${local} (${ageMin} menit lalu). Bisa jadi hari libur bursa, saham disuspensi, atau data tertunda.`;
    }
    return `Pasar sedang buka. Harga per ${local}; data bisa tertunda beberapa menit dari bursa.`;
  }
  return `Status pasar tidak dapat dipastikan. Harga terakhir per ${local}.`;
}

/** Parse respons JSON /v8/finance/chart menjadi struktur yang rapi. */
export function parseChart(json: any, opts: ParseOptions = {}): ChartResult {
  const err = json?.chart?.error;
  if (err) throw new Error(`Yahoo Finance: ${err.description ?? err.code ?? "error tidak diketahui"}`);
  const result = json?.chart?.result?.[0];
  if (!result?.meta) throw new Error("Data tidak ditemukan. Periksa kembali kode saham.");

  const meta = result.meta;
  const gmtOffset: number = num(meta.gmtoffset) ?? 7 * 3600;
  const tzLabel = gmtOffset === 7 * 3600 ? "WIB" : `UTC${gmtOffset >= 0 ? "+" : ""}${gmtOffset / 3600}`;
  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const q = result.indicators?.quote?.[0] ?? {};
  const adj: unknown[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];

  const candles: Candle[] = timestamps.map((t, i) => ({
    date: toDateString(t, gmtOffset),
    open: num(q.open?.[i]),
    high: num(q.high?.[i]),
    low: num(q.low?.[i]),
    close: num(q.close?.[i]),
    adjClose: num(adj[i]),
    volume: num(q.volume?.[i]),
  }));

  const dividends: Dividend[] = Object.values(result.events?.dividends ?? {})
    .map((d: any) => ({ date: num(d?.date), amount: num(d?.amount) }))
    .filter((d): d is { date: number; amount: number } => d.date !== null && d.amount !== null)
    .sort((a, b) => a.date - b.date)
    .map((d) => ({ date: toDateString(d.date, gmtOffset), amount: d.amount }));

  const splits: Split[] = Object.values(result.events?.splits ?? {})
    .map((s: any) => ({ date: num(s?.date), numerator: num(s?.numerator), denominator: num(s?.denominator), ratio: s?.splitRatio }))
    .filter((s): s is { date: number; numerator: number; denominator: number; ratio: any } =>
      s.date !== null && s.numerator !== null && s.denominator !== null && s.denominator > 0)
    .sort((a, b) => a.date - b.date)
    .map((s) => ({
      date: toDateString(s.date, gmtOffset),
      numerator: s.numerator,
      denominator: s.denominator,
      ratio: typeof s.ratio === "string" ? s.ratio : `${s.numerator}:${s.denominator}`,
    }));

  const withClose = candles.filter((c) => c.close !== null) as (Candle & { close: number })[];
  const lastCandle = withClose[withClose.length - 1];

  const price = num(meta.regularMarketPrice) ?? lastCandle?.close ?? null;
  if (price === null) throw new Error("Harga terakhir tidak tersedia untuk simbol ini.");

  const marketTime = num(meta.regularMarketTime);
  const marketDate = marketTime !== null ? toDateString(marketTime, gmtOffset) : null;

  // Penutupan kemarin:
  // 1) meta.previousClose bila Yahoo menyediakannya.
  // 2) Jika candle terakhir adalah hari yang sama dengan harga terkini → pakai candle sebelumnya.
  //    Jika candle hari ini belum muncul (candle terakhir < tanggal harga) → candle terakhir itu
  //    sendiri adalah penutupan sebelumnya.
  // chartPreviousClose sengaja TIDAK dipakai: itu penutupan sebelum awal rentang, bukan kemarin.
  let previousClose: number | null = num(meta.previousClose);
  let previousCloseSource: Quote["previousCloseSource"] = previousClose !== null ? "meta.previousClose" : "unavailable";
  if (previousClose === null && lastCandle) {
    if (marketDate && lastCandle.date < marketDate) {
      previousClose = lastCandle.close;
      previousCloseSource = "candle";
    } else if (withClose.length >= 2) {
      previousClose = withClose[withClose.length - 2].close;
      previousCloseSource = "candle";
    }
  }

  const change = previousClose !== null ? round(price - previousClose) : null;
  const changePct = previousClose ? round(((price - previousClose) / previousClose) * 100) : null;

  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const marketState = detectMarketState(meta, nowSec, gmtOffset);
  const dataAgeMinutes = marketTime !== null ? Math.max(0, Math.round((nowSec - marketTime) / 60)) : null;
  const dataAsOfLocal = marketTime !== null ? formatLocal(marketTime, gmtOffset, tzLabel) : null;
  // Catatan jeda siang hanya berlaku bila harga terakhir memang dari hari ini; jika tidak, biarkan peringatan harga basi.
  const priceIsToday = marketDate !== null && marketDate === toDateString(nowSec, gmtOffset);
  const lunchResumeAt = marketState === "open" && priceIsToday ? lunchBreakResumeAt(nowSec, gmtOffset) : null;
  const isIndex = meta.instrumentType === "INDEX" || String(meta.symbol ?? "").startsWith("^");

  return {
    quote: {
      symbol: meta.symbol,
      ticker: stripSuffix(meta.symbol),
      currency: meta.currency ?? "IDR",
      exchangeTimezone: meta.exchangeTimezoneName ?? "Asia/Jakarta",
      price,
      previousClose,
      previousCloseSource,
      change,
      changePct,
      dayHigh: num(meta.regularMarketDayHigh),
      dayLow: num(meta.regularMarketDayLow),
      fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow),
      pricePerLot: isIndex ? null : price * LOT_SIZE,
      dataAsOf: marketTime !== null ? new Date(marketTime * 1000).toISOString() : null,
      dataAsOfLocal,
      dataAgeMinutes,
      marketState,
      freshnessNote: buildFreshnessNote(marketState, dataAsOfLocal, dataAgeMinutes, lunchResumeAt, tzLabel),
    },
    candles,
    dividends,
    splits,
  };
}

export interface YahooClientOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  /** Sumber waktu (ms epoch); bisa diganti untuk test. */
  clock?: () => number;
  /** Jumlah percobaan ulang saat HTTP 429/5xx atau error jaringan. Default 2 (maksimal 3 panggilan). */
  maxRetries?: number;
  /** Jeda dasar backoff (ms); dilipatgandakan tiap percobaan, ditambah jitter. Default 500. */
  retryBaseMs?: number;
  /** Fungsi tunggu; bisa diganti untuk test agar tidak benar-benar menunggu. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** Batas atas jeda yang dihormati dari header Retry-After, agar tool tidak menggantung terlalu lama. */
export const MAX_RETRY_AFTER_MS = 15_000;

type FailOutcome = { kind: "fail"; error: Error; retryable: boolean; retryAfterMs: number | null };
type FetchOutcome = { kind: "ok"; data: ChartResult } | FailOutcome;

const failOutcome = (error: Error, retryable: boolean, retryAfterMs: number | null = null): FailOutcome =>
  ({ kind: "fail", error, retryable, retryAfterMs });

/** Header Retry-After dalam detik → ms (dibatasi MAX_RETRY_AFTER_MS). Format tanggal HTTP diabaikan. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class YahooClient {
  private fetchImpl: FetchLike;
  private baseUrl: string;
  private timeoutMs: number;
  private cacheTtlMs: number;
  readonly clock: () => number;
  private maxRetries: number;
  private retryBaseMs: number;
  private sleepImpl: (ms: number) => Promise<void>;
  private cache = new Map<string, { at: number; data: ChartResult }>();

  constructor(opts: YahooClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = opts.baseUrl ?? "https://query1.finance.yahoo.com";
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.cacheTtlMs = opts.cacheTtlMs ?? 60_000;
    this.clock = opts.clock ?? (() => Date.now());
    this.maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? 2));
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;
  }

  async chart(tickerInput: string, range: Range = "5d", interval: Interval = "1d"): Promise<ChartResult> {
    const symbol = normalizeTicker(tickerInput);
    const key = `${symbol}|${range}|${interval}`;
    const hit = this.cache.get(key);
    if (hit && this.clock() - hit.at < this.cacheTtlMs) return hit.data;

    const url =
      `${this.baseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
    const attempts = this.maxRetries + 1;
    let last: FailOutcome | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const outcome = await this.fetchOnce(url, tickerInput);
      if (outcome.kind === "ok") {
        this.cache.set(key, { at: this.clock(), data: outcome.data });
        return outcome.data;
      }
      last = outcome;
      if (!outcome.retryable || attempt === attempts) break;
      await this.sleepImpl(outcome.retryAfterMs ?? this.backoffMs(attempt));
    }
    const err = last ?? failOutcome(new Error("Gagal mengambil data."), false);
    throw err.retryable && attempts > 1 ? new Error(`${err.error.message} (sudah dicoba ${attempts} kali)`) : err.error;
  }

  /** Jeda backoff eksponensial dengan jitter: base × 2^(attempt−1) × [1, 1.5). */
  private backoffMs(attempt: number): number {
    const base = this.retryBaseMs * 2 ** (attempt - 1);
    return Math.round(base * (1 + Math.random() * 0.5));
  }

  /** Satu kali request + parse. Tidak melempar; mengembalikan hasil atau kegagalan beserta apakah layak diulang. */
  private async fetchOnce(url: string, tickerInput: string): Promise<FetchOutcome> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { "User-Agent": "Mozilla/5.0 (idx-stock-mcp)", Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      return failOutcome(describeFetchError(e, this.timeoutMs), true);
    }
    if (res.status === 404) return failOutcome(new Error(`Saham "${tickerInput}" tidak ditemukan.`), false);
    if (res.status === 429) {
      return failOutcome(
        new Error("Terlalu banyak permintaan ke Yahoo Finance (HTTP 429). Tunggu beberapa menit lalu coba lagi."),
        true,
        parseRetryAfter(res.headers.get("retry-after")),
      );
    }
    if (!res.ok) {
      return failOutcome(
        new Error(`Gagal mengambil data (${res.status} ${res.statusText}).`),
        res.status >= 500,
        parseRetryAfter(res.headers.get("retry-after")),
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return failOutcome(
        new Error("Respons Yahoo Finance bukan JSON yang valid; endpoint mungkin berubah atau akses sedang dibatasi."),
        false,
      );
    }
    try {
      return { kind: "ok", data: parseChart(body, { now: this.clock() }) };
    } catch (e) {
      return failOutcome(e instanceof Error ? e : new Error(String(e)), false);
    }
  }

  async quote(tickerInput: string): Promise<Quote> {
    return (await this.chart(tickerInput, "5d", "1d")).quote;
  }
}

/** Ubah error fetch (DNS, koneksi, timeout) menjadi pesan Bahasa Indonesia yang bisa ditindaklanjuti. */
function describeFetchError(e: unknown, timeoutMs: number): Error {
  const name = e instanceof Error ? e.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new Error(`Yahoo Finance tidak merespons dalam ${timeoutMs / 1000} detik. Coba lagi beberapa saat.`);
  }
  const cause = e instanceof Error ? (e.cause as { code?: unknown; message?: unknown } | undefined) : undefined;
  const reason =
    (typeof cause?.code === "string" && cause.code) ||
    (typeof cause?.message === "string" && cause.message) ||
    (e instanceof Error ? e.message : String(e));
  return new Error(`Tidak dapat terhubung ke Yahoo Finance (${reason}). Periksa koneksi internet.`);
}
