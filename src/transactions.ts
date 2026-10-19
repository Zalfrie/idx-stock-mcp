import { z } from "zod";
import { LOT_SIZE, type Dividend } from "./yahoo.js";

/**
 * Riwayat transaksi beli/jual di file portofolio. Semua fungsi di sini murni (tanpa I/O)
 * dan tidak mengubah input, agar mudah dites.
 *
 * Metode perhitungan: harga rata-rata (average cost), seperti yang ditampilkan sekuritas di Indonesia.
 * Fee beli masuk ke modal; saat jual, modal lembar yang dijual = lembar × harga rata-rata saat itu.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format tanggal harus YYYY-MM-DD");

export const TransactionSchema = z.object({
  ticker: z.string().min(2),
  type: z.enum(["buy", "sell"]),
  date: isoDate,
  lots: z.number().positive(),
  /** Harga per lembar. */
  price: z.number().positive(),
  /** Fee absolut (Rp) untuk transaksi ini. Jika diisi, menggantikan buyFeePct/sellFeePct. */
  fee: z.number().nonnegative().optional(),
  note: z.string().optional(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

export interface FeeRates {
  buyFeePct: number;
  sellFeePct: number;
}

export interface Position {
  ticker: string;
  shares: number;
  lots: number;
  /** Modal tersisa termasuk fee beli (metode harga rata-rata). 0 jika posisi habis. */
  cost: number;
  /** Harga rata-rata per lembar termasuk fee. 0 jika posisi habis. */
  avgPrice: number;
  /** Untung/rugi yang sudah terealisasi dari semua penjualan, setelah fee jual. */
  realizedPnl: number;
  buyCount: number;
  sellCount: number;
  firstBuyDate: string;
  lastTransactionDate: string;
}

export interface DividendReceipt {
  /** Ex-date. */
  date: string;
  amountPerShare: number;
  /** Lembar yang dipegang sebelum ex-date. */
  shares: number;
  total: number;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const normalizeHoldingTicker = (t: string): string => t.trim().toUpperCase().replace(/\.JK$/, "");

/** Fee sebuah transaksi: nilai absolut jika diisi, selain itu persen dari nilai transaksi. */
function transactionFee(t: Transaction, rates: FeeRates): number {
  if (t.fee !== undefined) return t.fee;
  const pct = t.type === "buy" ? rates.buyFeePct : rates.sellFeePct;
  return (t.lots * LOT_SIZE * t.price * pct) / 100;
}

/** Urutkan menaik berdasarkan tanggal; pada hari yang sama, beli diproses sebelum jual. Tidak mengubah input. */
export function sortTransactions(txs: readonly Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.type !== b.type) return a.type === "buy" ? -1 : 1;
    return 0;
  });
}

function emptyPosition(ticker: string, date: string): Position {
  return {
    ticker, shares: 0, lots: 0, cost: 0, avgPrice: 0, realizedPnl: 0,
    buyCount: 0, sellCount: 0, firstBuyDate: date, lastTransactionDate: date,
  };
}

function applyBuy(prev: Position, t: Transaction, fee: number): Position {
  const shares = t.lots * LOT_SIZE;
  return {
    ...prev,
    shares: prev.shares + shares,
    cost: prev.cost + shares * t.price + fee,
    buyCount: prev.buyCount + 1,
    lastTransactionDate: t.date,
  };
}

function applySell(prev: Position, t: Transaction, fee: number): Position {
  const shares = t.lots * LOT_SIZE;
  if (shares > prev.shares + 1e-9) {
    throw new Error(
      `Transaksi jual ${prev.ticker} ${t.date}: menjual ${t.lots} lot padahal hanya punya ${prev.shares / LOT_SIZE} lot saat itu. ` +
        "Periksa urutan/tanggal transaksi di file portofolio.",
    );
  }
  const avg = prev.cost / prev.shares;
  const soldCost = shares * avg;
  const proceeds = shares * t.price - fee;
  return {
    ...prev,
    shares: prev.shares - shares,
    cost: prev.cost - soldCost,
    realizedPnl: prev.realizedPnl + (proceeds - soldCost),
    sellCount: prev.sellCount + 1,
    lastTransactionDate: t.date,
  };
}

function finalize(p: Position): Position {
  const closed = p.shares <= 1e-9;
  return {
    ...p,
    shares: closed ? 0 : p.shares,
    lots: closed ? 0 : p.shares / LOT_SIZE,
    cost: closed ? 0 : round(p.cost),
    avgPrice: closed ? 0 : round(p.cost / p.shares),
    realizedPnl: round(p.realizedPnl),
  };
}

/**
 * Hitung posisi per ticker (tanpa .JK, huruf besar) dari riwayat transaksi.
 * Melempar error bila ada penjualan melebihi kepemilikan pada tanggal itu.
 */
export function derivePositions(txs: readonly Transaction[], rates: FeeRates): Map<string, Position> {
  const positions = sortTransactions(txs).reduce((acc, t) => {
    const ticker = normalizeHoldingTicker(t.ticker);
    const prev = acc.get(ticker) ?? emptyPosition(ticker, t.date);
    const fee = transactionFee(t, rates);
    const next = t.type === "buy" ? applyBuy(prev, t, fee) : applySell(prev, t, fee);
    return new Map(acc).set(ticker, next);
  }, new Map<string, Position>());
  return new Map([...positions].map(([ticker, p]) => [ticker, finalize(p)]));
}

/**
 * Dividen yang diterima untuk SATU ticker: untuk tiap ex-date, lembar yang dipegang berdasarkan
 * transaksi bertanggal sebelum ex-date (beli tepat di ex-date tidak berhak; jual tepat di ex-date masih berhak).
 * Nilai bruto, sebelum pajak dividen.
 */
export function dividendsReceived(
  txs: readonly Transaction[],
  dividends: readonly Dividend[],
): { total: number; items: DividendReceipt[] } {
  const sorted = sortTransactions(txs);
  const items = [...dividends]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => {
      const shares = sorted
        .filter((t) => t.date < d.date)
        .reduce((s, t) => s + (t.type === "buy" ? 1 : -1) * t.lots * LOT_SIZE, 0);
      return { date: d.date, amountPerShare: d.amount, shares, total: round(shares * d.amount) };
    })
    .filter((r) => r.shares > 0);
  return { total: round(items.reduce((s, r) => s + r.total, 0)), items };
}
