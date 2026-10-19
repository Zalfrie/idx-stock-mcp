import { readFile } from "node:fs/promises";
import { z } from "zod";
import { LOT_SIZE, type Quote } from "./yahoo.js";

/**
 * Format file portofolio (JSON), contoh ada di portfolio.example.json.
 * File ini hanya DIBACA oleh server — tidak ada eksekusi order apa pun.
 */
export const PortfolioSchema = z.object({
  /** Fee jual dalam persen, untuk estimasi hasil bersih jika dijual. Default 0.25. */
  sellFeePct: z.number().min(0).max(5).default(0.25),
  holdings: z
    .array(
      z.object({
        ticker: z.string().min(2),
        lots: z.number().positive(),
        /** Harga rata-rata beli per lembar (sudah termasuk fee beli kalau mau akurat). */
        avgPrice: z.number().positive(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  /** Aset yang tidak ada di bursa (mis. reksa dana di Bibit) — nilainya diisi manual. */
  manual: z
    .array(
      z.object({
        name: z.string().min(1),
        invested: z.number().nonnegative(),
        currentValue: z.number().nonnegative(),
        updatedAt: z.string().optional(),
      }),
    )
    .default([]),
});

export type Portfolio = z.infer<typeof PortfolioSchema>;

export async function loadPortfolio(path: string): Promise<Portfolio> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") {
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

export interface HoldingValuation {
  ticker: string;
  lots: number;
  shares: number;
  avgPrice: number;
  lastPrice: number | null;
  cost: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  estNetIfSold: number | null;
  dayChangePct: number | null;
  error?: string;
  note?: string;
}

export interface PortfolioValuation {
  holdings: HoldingValuation[];
  manual: Portfolio["manual"];
  totals: {
    cost: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number | null;
    estNetIfSold: number;
    incomplete: boolean;
  };
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Hitung nilai portofolio dari harga terkini. quotes: map ticker (tanpa .JK, uppercase) -> Quote | Error. */
export function valuePortfolio(p: Portfolio, quotes: Map<string, Quote | Error>): PortfolioValuation {
  const sellFee = p.sellFeePct / 100;
  let cost = 0, mv = 0, net = 0, incomplete = false;

  const holdings: HoldingValuation[] = p.holdings.map((h) => {
    const ticker = h.ticker.trim().toUpperCase().replace(/\.JK$/, "");
    const shares = h.lots * LOT_SIZE;
    const hCost = shares * h.avgPrice;
    cost += hCost;
    const q = quotes.get(ticker);
    if (!q || q instanceof Error) {
      incomplete = true;
      // tetap masukkan biaya ke total nilai agar total tidak terlihat rugi palsu
      mv += hCost;
      net += hCost;
      return {
        ticker, lots: h.lots, shares, avgPrice: h.avgPrice, lastPrice: null, cost: hCost,
        marketValue: null, unrealizedPnl: null, unrealizedPnlPct: null, estNetIfSold: null, dayChangePct: null,
        error: q instanceof Error ? q.message : "Harga tidak tersedia", note: h.note,
      };
    }
    const value = shares * q.price;
    const estNet = value * (1 - sellFee);
    mv += value;
    net += estNet;
    return {
      ticker, lots: h.lots, shares, avgPrice: h.avgPrice, lastPrice: q.price, cost: hCost,
      marketValue: value,
      unrealizedPnl: round(value - hCost),
      unrealizedPnlPct: round(((value - hCost) / hCost) * 100),
      estNetIfSold: round(estNet),
      dayChangePct: q.changePct, note: h.note,
    };
  });

  for (const m of p.manual) {
    cost += m.invested;
    mv += m.currentValue;
    net += m.currentValue;
  }

  return {
    holdings,
    manual: p.manual,
    totals: {
      cost: round(cost),
      marketValue: round(mv),
      unrealizedPnl: round(mv - cost),
      unrealizedPnlPct: cost > 0 ? round(((mv - cost) / cost) * 100) : null,
      estNetIfSold: round(net),
      incomplete,
    },
  };
}
