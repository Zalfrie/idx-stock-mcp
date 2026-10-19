import { readFile } from "node:fs/promises";
import { z } from "zod";
import { LOT_SIZE, type Quote, type Split } from "./yahoo.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format tanggal harus YYYY-MM-DD");

/**
 * Format file portofolio (JSON), contoh ada di portfolio.example.json.
 * File ini hanya DIBACA oleh server — tidak ada eksekusi order apa pun.
 */
export const PortfolioSchema = z.object({
  /**
   * Fee jual dalam persen (termasuk pajak penjualan), untuk ESTIMASI hasil bersih jika dijual.
   * Default 0.25. Sesuaikan dengan tarif sekuritas Anda.
   */
  sellFeePct: z.number().min(0).max(5).default(0.25),
  /** Hari setelah nilai aset manual dianggap usang. Default 7. */
  manualStaleDays: z.number().int().positive().default(7),
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
});

export type Portfolio = z.infer<typeof PortfolioSchema>;
export type Holding = Portfolio["holdings"][number];

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

export const normalizeHoldingTicker = (t: string) => t.trim().toUpperCase().replace(/\.JK$/, "");

/** Data pasar per ticker yang dibutuhkan untuk valuasi. */
export interface MarketData {
  quote: Quote | Error;
  /** Riwayat split; Error jika gagal dicek; undefined jika tidak dicek. */
  splits?: Split[] | Error;
  /** Tanggal paling awal yang tercakup oleh pengecekan split (YYYY-MM-DD). */
  splitsCheckedSince?: string;
}

export interface HoldingValuation {
  ticker: string;
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
  warnings: string[];
  note?: string;
}

export interface PortfolioValuation {
  holdings: HoldingValuation[];
  manual: (Portfolio["manual"][number] & { stale: boolean; pnl: number })[];
  totals: {
    /** Hanya dari saham yang harganya berhasil diambil + aset manual. */
    cost: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number | null;
    estimatedNetIfSold: number;
    /** true jika ada saham yang TIDAK ikut dihitung karena harganya gagal diambil. */
    incomplete: boolean;
    excludedTickers: string[];
    excludedCost: number;
  };
  assumptions: {
    sellFeePct: number;
    buyFee: string;
    lotSize: number;
    estimate: string;
  };
  /** Peringatan yang WAJIB disampaikan ke pengguna bersama angka-angkanya. */
  warnings: string[];
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function daysBetween(fromIso: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** Hitung nilai portofolio dari data pasar. market: ticker (tanpa .JK, uppercase) -> MarketData. */
export function valuePortfolio(p: Portfolio, market: Map<string, MarketData>, nowMs: number = Date.now()): PortfolioValuation {
  const sellFee = p.sellFeePct / 100;
  const warnings: string[] = [];
  let cost = 0, mv = 0, net = 0, excludedCost = 0;
  const excluded: string[] = [];

  const holdings: HoldingValuation[] = p.holdings.map((h) => {
    const ticker = normalizeHoldingTicker(h.ticker);
    const shares = h.lots * LOT_SIZE;
    const hCost = round(shares * h.avgPrice);
    const md = market.get(ticker);
    const hw: string[] = [];

    // Pengecekan stock split setelah tanggal beli
    if (md?.splits instanceof Error) {
      hw.push(`Tidak dapat mengecek stock split untuk ${ticker}: ${md.splits.message}`);
    } else if (md?.splits) {
      const since = h.buyDate ?? md.splitsCheckedSince;
      const after = md.splits.filter((s) => (since ? s.date >= since : true));
      for (const s of after) {
        hw.push(
          `${ticker} melakukan stock split ${s.ratio} pada ${s.date}${h.buyDate ? " (setelah tanggal beli)" : ""}. ` +
            `Pastikan jumlah lot dan avgPrice di file portofolio sudah disesuaikan, jika belum untung/rugi akan sangat salah.`,
        );
      }
      if (!h.buyDate && md.splitsCheckedSince) {
        hw.push(`buyDate untuk ${ticker} tidak diisi; stock split hanya dicek sejak ${md.splitsCheckedSince}.`);
      }
    }

    const q = md?.quote;
    if (!q || q instanceof Error) {
      excluded.push(ticker);
      excludedCost += hCost;
      hw.push(`Harga ${ticker} gagal diambil (${q instanceof Error ? q.message : "tidak tersedia"}); saham ini TIDAK dihitung dalam total.`);
      warnings.push(...hw);
      return {
        ticker, lots: h.lots, shares, avgPrice: h.avgPrice, cost: hCost, status: "unpriced",
        lastPrice: null, priceAsOf: null, marketState: null, marketValue: null, unrealizedPnl: null,
        unrealizedPnlPct: null, estimatedNetIfSold: null, dayChangePct: null, warnings: hw, note: h.note,
      };
    }

    const value = round(shares * q.price);
    const estNet = round(value * (1 - sellFee));
    cost += hCost;
    mv += value;
    net += estNet;
    warnings.push(...hw);
    return {
      ticker, lots: h.lots, shares, avgPrice: h.avgPrice, cost: hCost, status: "priced",
      lastPrice: q.price, priceAsOf: q.dataAsOfLocal, marketState: q.marketState,
      marketValue: value,
      unrealizedPnl: round(value - hCost),
      unrealizedPnlPct: round(((value - hCost) / hCost) * 100),
      estimatedNetIfSold: estNet,
      dayChangePct: q.changePct, warnings: hw, note: h.note,
    };
  });

  const manual = p.manual.map((m) => {
    const stale = m.updatedAt ? daysBetween(m.updatedAt, nowMs) > p.manualStaleDays : true;
    if (stale) {
      warnings.push(
        m.updatedAt
          ? `Nilai "${m.name}" terakhir diperbarui ${m.updatedAt} (lebih dari ${p.manualStaleDays} hari lalu); angkanya mungkin sudah tidak sesuai.`
          : `Nilai "${m.name}" tidak punya updatedAt; tidak diketahui kapan terakhir diperbarui.`,
      );
    }
    cost += m.invested;
    mv += m.currentValue;
    net += m.currentValue;
    return { ...m, stale, pnl: round(m.currentValue - m.invested) };
  });

  if (excluded.length > 0) {
    warnings.unshift(
      `Total TIDAK LENGKAP: ${excluded.join(", ")} tidak ikut dihitung (modal Rp${excludedCost.toLocaleString("id-ID")}).`,
    );
  }

  const states = new Set(holdings.filter((h) => h.status === "priced").map((h) => h.marketState));
  if (states.has("closed") && !states.has("open")) {
    warnings.push("Pasar sedang tutup; nilai saham memakai harga penutupan terakhir.");
  }

  return {
    holdings,
    manual,
    totals: {
      cost: round(cost),
      marketValue: round(mv),
      unrealizedPnl: round(mv - cost),
      unrealizedPnlPct: cost > 0 ? round(((mv - cost) / cost) * 100) : null,
      estimatedNetIfSold: round(net),
      incomplete: excluded.length > 0,
      excludedTickers: excluded,
      excludedCost: round(excludedCost),
    },
    assumptions: {
      sellFeePct: p.sellFeePct,
      buyFee: "Fee beli tidak ditambahkan terpisah; modal = lot × 100 × avgPrice. Masukkan fee beli ke avgPrice jika ingin akurat.",
      lotSize: LOT_SIZE,
      estimate:
        "estimatedNetIfSold adalah perkiraan: nilai pasar dikurangi sellFeePct. Hasil jual sebenarnya tergantung harga saat order tereksekusi dan tarif sekuritas.",
    },
    warnings,
  };
}
