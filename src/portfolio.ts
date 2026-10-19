import { readFile } from "node:fs/promises";
import { z } from "zod";
import { LOT_SIZE, type Dividend, type Quote, type Split } from "./yahoo.js";
import {
  derivePositions,
  dividendsReceived,
  normalizeHoldingTicker,
  TransactionSchema,
  type DividendReceipt,
  type Position,
  type Transaction,
} from "./transactions.js";

export { normalizeHoldingTicker } from "./transactions.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format tanggal harus YYYY-MM-DD");

/**
 * Format file portofolio (JSON), contoh ada di portfolio.example.json.
 * File ini hanya DIBACA oleh server — tidak ada eksekusi order apa pun.
 */
export const PortfolioSchema = z
  .object({
    /** Fee beli dalam persen. Dipakai untuk transaksi di `transactions` yang tidak mengisi `fee`. Default 0.15. */
    buyFeePct: z.number().min(0).max(5).default(0.15),
    /**
     * Fee jual dalam persen (termasuk pajak penjualan), untuk ESTIMASI hasil bersih jika dijual
     * dan untuk transaksi jual di `transactions` yang tidak mengisi `fee`. Default 0.25.
     */
    sellFeePct: z.number().min(0).max(5).default(0.25),
    /** Hari setelah nilai aset manual dianggap usang. Default 7. */
    manualStaleDays: z.number().int().positive().default(7),
    /** Posisi yang diisi manual (lot + harga rata-rata). Untuk ticker yang punya `transactions`, jangan diisi di sini. */
    holdings: z
      .array(
        z.object({
          ticker: z.string().min(2),
          lots: z.number().positive(),
          /** Harga rata-rata beli per lembar. Masukkan fee beli ke sini jika ingin modal yang akurat. */
          avgPrice: z.number().positive(),
          /** Tanggal pembelian pertama. Dipakai untuk mendeteksi stock split sesudahnya. */
          buyDate: isoDate.optional(),
          note: z.string().optional(),
        }),
      )
      .default([]),
    /** Riwayat beli/jual. Posisi, realized profit, dan dividen diterima dihitung dari sini (metode harga rata-rata). */
    transactions: z.array(TransactionSchema).default([]),
    /** Aset yang tidak ada di bursa (mis. reksa dana di Bibit) — nilainya diisi manual. */
    manual: z
      .array(
        z.object({
          name: z.string().min(1),
          invested: z.number().nonnegative(),
          currentValue: z.number().nonnegative(),
          updatedAt: isoDate.optional(),
        }),
      )
      .default([]),
  })
  .superRefine((p, ctx) => {
    const inTx = new Set(p.transactions.map((t) => normalizeHoldingTicker(t.ticker)));
    const both = [...new Set(p.holdings.map((h) => normalizeHoldingTicker(h.ticker)).filter((t) => inTx.has(t)))];
    for (const t of both) {
      ctx.addIssue({
        code: "custom",
        message: `Ticker ${t} ada di "holdings" dan "transactions" sekaligus; pilih salah satu agar tidak dihitung dua kali.`,
      });
    }
  });

export type Portfolio = z.infer<typeof PortfolioSchema>;
export type Holding = Portfolio["holdings"][number];

export async function loadPortfolio(path: string): Promise<Portfolio> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "ENOENT") {
      throw new Error(`File portofolio tidak ditemukan di ${path}. Salin portfolio.example.json lalu set IDX_PORTFOLIO_PATH.`);
    }
    throw e;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`File portofolio ${path} bukan JSON yang valid.`);
  }
  const parsed = PortfolioSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Format portofolio tidak valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** Data pasar per ticker yang dibutuhkan untuk valuasi. */
export interface MarketData {
  quote: Quote | Error;
  /** Riwayat split; Error jika gagal dicek; undefined jika tidak dicek. */
  splits?: Split[] | Error;
  /** Riwayat dividen (ex-date); Error jika gagal dicek; undefined jika tidak dicek. */
  dividends?: Dividend[] | Error;
  /** Tanggal paling awal yang tercakup oleh pengecekan split (YYYY-MM-DD). */
  splitsCheckedSince?: string;
}

export type HoldingSource = "manual" | "transactions";

export interface HoldingValuation {
  ticker: string;
  source: HoldingSource;
  lots: number;
  shares: number;
  avgPrice: number;
  cost: number;
  status: "priced" | "unpriced";
  lastPrice: number | null;
  priceAsOf: string | null;
  marketState: Quote["marketState"] | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  estimatedNetIfSold: number | null;
  dayChangePct: number | null;
  /** Untung/rugi terealisasi dari penjualan sebelumnya (hanya untuk source "transactions"). */
  realizedPnl: number | null;
  /** Dividen bruto yang diterima selama memegang saham (hanya untuk source "transactions"). */
  dividendsReceived: number | null;
  dividends: DividendReceipt[];
  warnings: string[];
  note?: string;
}

export interface ClosedPosition {
  ticker: string;
  realizedPnl: number;
  dividendsReceived: number | null;
  dividends: DividendReceipt[];
  buyCount: number;
  sellCount: number;
  firstBuyDate: string;
  lastTransactionDate: string;
  warnings: string[];
}

export interface PortfolioValuation {
  holdings: HoldingValuation[];
  /** Posisi dari `transactions` yang sudah habis dijual. */
  closed: ClosedPosition[];
  manual: (Portfolio["manual"][number] & { stale: boolean; pnl: number })[];
  totals: {
    /** Hanya dari saham yang harganya berhasil diambil + aset manual. */
    cost: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number | null;
    estimatedNetIfSold: number;
    /** Realized dari semua transaksi jual (posisi terbuka + tertutup). */
    realizedPnl: number;
    /** Dividen bruto yang diterima, hanya dari ticker yang punya `transactions` dan datanya tersedia. */
    dividendsReceived: number;
    /** unrealizedPnl + realizedPnl + dividendsReceived. */
    totalReturn: number;
    /** true jika ada saham yang TIDAK ikut dihitung karena harganya gagal diambil. */
    incomplete: boolean;
    excludedTickers: string[];
    excludedCost: number;
  };
  assumptions: {
    buyFeePct: number;
    sellFeePct: number;
    buyFee: string;
    lotSize: number;
    costMethod: "average";
    dividendTax: string;
    estimate: string;
    totalReturn: string;
  };
  /** Peringatan yang WAJIB disampaikan ke pengguna bersama angka-angkanya. */
  warnings: string[];
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function daysBetween(fromIso: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** Posisi yang akan dinilai, baik dari `holdings` manual maupun hasil `transactions`. */
interface EffectiveHolding {
  ticker: string;
  source: HoldingSource;
  lots: number;
  shares: number;
  avgPrice: number;
  cost: number;
  buyDate?: string;
  note?: string;
  realizedPnl: number | null;
  txs: Transaction[];
}

function fromManual(h: Holding): EffectiveHolding {
  const shares = h.lots * LOT_SIZE;
  return {
    ticker: normalizeHoldingTicker(h.ticker), source: "manual", lots: h.lots, shares, avgPrice: h.avgPrice,
    cost: round(shares * h.avgPrice), buyDate: h.buyDate, note: h.note, realizedPnl: null, txs: [],
  };
}

function fromPosition(p: Position, txs: Transaction[]): EffectiveHolding {
  return {
    ticker: p.ticker, source: "transactions", lots: p.lots, shares: p.shares, avgPrice: p.avgPrice, cost: p.cost,
    buyDate: p.firstBuyDate, realizedPnl: p.realizedPnl, txs,
  };
}

function splitWarnings(ticker: string, buyDate: string | undefined, md: MarketData | undefined): string[] {
  if (md?.splits instanceof Error) return [`Tidak dapat mengecek stock split untuk ${ticker}: ${md.splits.message}`];
  if (!md?.splits) return [];
  const since = buyDate ?? md.splitsCheckedSince;
  const after = md.splits.filter((s) => (since ? s.date >= since : true));
  const perSplit = after.map(
    (s) =>
      `${ticker} melakukan stock split ${s.ratio} pada ${s.date}${buyDate ? " (setelah tanggal beli)" : ""}. ` +
      `Pastikan jumlah lot dan avgPrice di file portofolio sudah disesuaikan, jika belum untung/rugi akan sangat salah.`,
  );
  const noDate = !buyDate && md.splitsCheckedSince
    ? [`buyDate untuk ${ticker} tidak diisi; stock split hanya dicek sejak ${md.splitsCheckedSince}.`]
    : [];
  return [...perSplit, ...noDate];
}

/** Dividen diterima untuk ticker yang punya transaksi; null + peringatan bila datanya tidak tersedia. */
function dividendSummary(
  ticker: string,
  txs: Transaction[],
  md: MarketData | undefined,
): { total: number | null; items: DividendReceipt[]; warnings: string[] } {
  if (md?.dividends instanceof Error) {
    return { total: null, items: [], warnings: [`Dividen diterima untuk ${ticker} tidak dapat dihitung: ${md.dividends.message}`] };
  }
  if (!md?.dividends) {
    return { total: null, items: [], warnings: [`Dividen diterima untuk ${ticker} tidak dicek (data dividen tidak tersedia).`] };
  }
  const r = dividendsReceived(txs, md.dividends);
  return { total: r.total, items: r.items, warnings: [] };
}

function valueHolding(h: EffectiveHolding, md: MarketData | undefined, sellFee: number): HoldingValuation {
  const hw = splitWarnings(h.ticker, h.buyDate, md);
  const div = h.source === "transactions" ? dividendSummary(h.ticker, h.txs, md) : { total: null, items: [], warnings: [] };
  const base = {
    ticker: h.ticker, source: h.source, lots: h.lots, shares: h.shares, avgPrice: h.avgPrice, cost: h.cost,
    realizedPnl: h.realizedPnl, dividendsReceived: div.total, dividends: div.items, note: h.note,
  };
  const q = md?.quote;
  if (!q || q instanceof Error) {
    const reason = q instanceof Error ? q.message : "tidak tersedia";
    return {
      ...base, status: "unpriced", lastPrice: null, priceAsOf: null, marketState: null, marketValue: null,
      unrealizedPnl: null, unrealizedPnlPct: null, estimatedNetIfSold: null, dayChangePct: null,
      warnings: [...hw, ...div.warnings, `Harga ${h.ticker} gagal diambil (${reason}); saham ini TIDAK dihitung dalam total.`],
    };
  }
  const value = round(h.shares * q.price);
  return {
    ...base, status: "priced", lastPrice: q.price, priceAsOf: q.dataAsOfLocal, marketState: q.marketState,
    marketValue: value,
    unrealizedPnl: round(value - h.cost),
    unrealizedPnlPct: round(((value - h.cost) / h.cost) * 100),
    estimatedNetIfSold: round(value * (1 - sellFee)),
    dayChangePct: q.changePct,
    warnings: [...hw, ...div.warnings],
  };
}

function closedPosition(p: Position, txs: Transaction[], md: MarketData | undefined): ClosedPosition {
  const div = dividendSummary(p.ticker, txs, md);
  return {
    ticker: p.ticker, realizedPnl: p.realizedPnl, dividendsReceived: div.total, dividends: div.items,
    buyCount: p.buyCount, sellCount: p.sellCount, firstBuyDate: p.firstBuyDate, lastTransactionDate: p.lastTransactionDate,
    warnings: div.warnings,
  };
}

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/** Hitung nilai portofolio dari data pasar. market: ticker (tanpa .JK, uppercase) -> MarketData. */
export function valuePortfolio(p: Portfolio, market: Map<string, MarketData>, nowMs: number = Date.now()): PortfolioValuation {
  const sellFee = p.sellFeePct / 100;
  const positions = derivePositions(p.transactions, { buyFeePct: p.buyFeePct, sellFeePct: p.sellFeePct });
  const txsOf = (ticker: string) => p.transactions.filter((t) => normalizeHoldingTicker(t.ticker) === ticker);

  const effective: EffectiveHolding[] = [
    ...p.holdings.map(fromManual),
    ...[...positions.values()].filter((pos) => pos.shares > 0).map((pos) => fromPosition(pos, txsOf(pos.ticker))),
  ];
  const holdings = effective.map((h) => valueHolding(h, market.get(h.ticker), sellFee));
  const closed = [...positions.values()]
    .filter((pos) => pos.shares === 0)
    .map((pos) => closedPosition(pos, txsOf(pos.ticker), market.get(pos.ticker)));

  const priced = holdings.filter((h) => h.status === "priced");
  const unpriced = holdings.filter((h) => h.status === "unpriced");
  const excluded = unpriced.map((h) => h.ticker);
  const excludedCost = round(sum(unpriced.map((h) => h.cost)));

  const manual = p.manual.map((m) => {
    const stale = m.updatedAt ? daysBetween(m.updatedAt, nowMs) > p.manualStaleDays : true;
    return { ...m, stale, pnl: round(m.currentValue - m.invested) };
  });
  const manualWarnings = manual
    .filter((m) => m.stale)
    .map((m) =>
      m.updatedAt
        ? `Nilai "${m.name}" terakhir diperbarui ${m.updatedAt} (lebih dari ${p.manualStaleDays} hari lalu); angkanya mungkin sudah tidak sesuai.`
        : `Nilai "${m.name}" tidak punya updatedAt; tidak diketahui kapan terakhir diperbarui.`,
    );

  const cost = round(sum(priced.map((h) => h.cost)) + sum(manual.map((m) => m.invested)));
  const mv = round(sum(priced.map((h) => h.marketValue ?? 0)) + sum(manual.map((m) => m.currentValue)));
  const net = round(sum(priced.map((h) => h.estimatedNetIfSold ?? 0)) + sum(manual.map((m) => m.currentValue)));
  const unrealizedPnl = round(mv - cost);
  const realizedPnl = round(sum([...holdings, ...closed].map((h) => h.realizedPnl ?? 0)));
  const dividendsTotal = round(sum([...holdings, ...closed].map((h) => h.dividendsReceived ?? 0)));

  const today = new Date(nowMs).toISOString().slice(0, 10);
  const futureWarnings = p.transactions
    .filter((t) => t.date > today)
    .map((t) => `Transaksi ${t.type === "buy" ? "beli" : "jual"} ${normalizeHoldingTicker(t.ticker)} bertanggal ${t.date} berada di masa depan; periksa tanggalnya.`);

  const states = new Set(priced.map((h) => h.marketState));
  const marketWarnings = states.has("closed") && !states.has("open") ? ["Pasar sedang tutup; nilai saham memakai harga penutupan terakhir."] : [];
  const incompleteWarnings = excluded.length > 0
    ? [`Total TIDAK LENGKAP: ${excluded.join(", ")} tidak ikut dihitung (modal Rp${excludedCost.toLocaleString("id-ID")}).`]
    : [];

  return {
    holdings,
    closed,
    manual,
    totals: {
      cost,
      marketValue: mv,
      unrealizedPnl,
      unrealizedPnlPct: cost > 0 ? round((unrealizedPnl / cost) * 100) : null,
      estimatedNetIfSold: net,
      realizedPnl,
      dividendsReceived: dividendsTotal,
      totalReturn: round(unrealizedPnl + realizedPnl + dividendsTotal),
      incomplete: excluded.length > 0,
      excludedTickers: excluded,
      excludedCost,
    },
    assumptions: {
      buyFeePct: p.buyFeePct,
      sellFeePct: p.sellFeePct,
      buyFee:
        "Untuk `transactions`: fee beli (buyFeePct atau `fee`) masuk ke modal. Untuk `holdings` manual: fee beli tidak ditambahkan; modal = lot × 100 × avgPrice.",
      lotSize: LOT_SIZE,
      costMethod: "average",
      dividendTax:
        "dividendsReceived adalah nilai bruto berdasarkan ex-date dan lembar yang dipegang sebelum ex-date. Pajak dividen (umumnya 10% final untuk individu, kecuali diinvestasikan kembali) belum dikurangi.",
      estimate:
        "estimatedNetIfSold adalah perkiraan: nilai pasar dikurangi sellFeePct. Hasil jual sebenarnya tergantung harga saat order tereksekusi dan tarif sekuritas.",
      totalReturn: "totalReturn = unrealizedPnl + realizedPnl + dividendsReceived. Aset manual hanya masuk unrealizedPnl.",
    },
    warnings: [
      ...incompleteWarnings,
      ...holdings.flatMap((h) => h.warnings),
      ...closed.flatMap((c) => c.warnings),
      ...futureWarnings,
      ...manualWarnings,
      ...marketWarnings,
    ],
  };
}
