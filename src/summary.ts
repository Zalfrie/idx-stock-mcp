import type { Candle, ChartResult } from "./yahoo.js";

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export interface PerformanceSummary {
  from: string;
  to: string;
  startClose: number;
  endClose: number;
  /** Perubahan harga saja (tanpa dividen). */
  priceReturnPct: number;
  /** Perubahan harga + dividen (dari harga yang disesuaikan). Null jika data penyesuaian tidak tersedia. */
  totalReturnPct: number | null;
  dividendsInRange: { date: string; amount: number }[];
  dividendsPerShareInRange: number;
  splitsInRange: { date: string; ratio: string }[];
  high: number;
  low: number;
  maxDrawdownPct: number;
  tradingDays: number;
  notes: string[];
}

/** Ringkasan performa dari hasil chart. */
export function summarize(chart: Pick<ChartResult, "candles" | "dividends" | "splits">): PerformanceSummary | null {
  const closes = chart.candles.filter((c) => c.close !== null) as (Candle & { close: number })[];
  if (closes.length === 0) return null;
  const first = closes[0], last = closes[closes.length - 1];

  let high = -Infinity, low = Infinity, peak = -Infinity, maxDrawdown = 0;
  for (const c of closes) {
    high = Math.max(high, c.high ?? c.close);
    low = Math.min(low, c.low ?? c.close);
    // drawdown dihitung dari harga disesuaikan bila ada, agar split tidak terbaca sebagai "anjlok"
    const v = c.adjClose ?? c.close;
    peak = Math.max(peak, v);
    maxDrawdown = Math.min(maxDrawdown, (v - peak) / peak);
  }

  const totalReturnPct =
    first.adjClose !== null && last.adjClose !== null && first.adjClose > 0
      ? round(((last.adjClose - first.adjClose) / first.adjClose) * 100)
      : null;

  const inRange = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date > first.date && x.date <= last.date);
  const dividendsInRange = inRange(chart.dividends);
  const splitsInRange = inRange(chart.splits).map((s) => ({ date: s.date, ratio: s.ratio }));

  const notes: string[] = [
    "priceReturnPct hanya menghitung perubahan harga; totalReturnPct sudah memasukkan dividen (jika data tersedia).",
  ];
  if (totalReturnPct === null) notes.push("Data harga disesuaikan (dividen/split) tidak tersedia, totalReturnPct tidak dapat dihitung.");
  if (splitsInRange.length > 0) {
    notes.push("Ada stock split dalam rentang ini. Harga lama mungkin tidak sebanding langsung dengan harga sekarang; gunakan totalReturnPct.");
  }

  return {
    from: first.date,
    to: last.date,
    startClose: first.close,
    endClose: last.close,
    priceReturnPct: round(((last.close - first.close) / first.close) * 100),
    totalReturnPct,
    dividendsInRange,
    dividendsPerShareInRange: round(dividendsInRange.reduce((s, d) => s + d.amount, 0), 4),
    splitsInRange,
    high,
    low,
    maxDrawdownPct: round(maxDrawdown * 100),
    tradingDays: closes.length,
    notes,
  };
}
