import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePositions, dividendsReceived, sortTransactions, type Transaction } from "../src/transactions.js";

const FEES = { buyFeePct: 0.15, sellFeePct: 0.25 };
const buy = (ticker: string, date: string, lots: number, price: number, extra: Partial<Transaction> = {}): Transaction =>
  ({ ticker, type: "buy", date, lots, price, ...extra });
const sell = (ticker: string, date: string, lots: number, price: number, extra: Partial<Transaction> = {}): Transaction =>
  ({ ticker, type: "sell", date, lots, price, ...extra });

test("harga rata-rata: dua kali beli, fee beli masuk modal", () => {
  const pos = derivePositions([buy("BBCA", "2026-01-05", 1, 4820), buy("bbca.jk", "2026-02-05", 1, 5200)], FEES);
  const p = pos.get("BBCA")!;
  // modal = 482.000 + 723 + 520.000 + 780 = 1.003.503 → avg 5.017,52
  assert.equal(p.shares, 200);
  assert.equal(p.lots, 2);
  assert.equal(p.cost, 1_003_503);
  assert.equal(p.avgPrice, 5017.52);
  assert.equal(p.realizedPnl, 0);
  assert.equal(p.firstBuyDate, "2026-01-05");
  assert.equal(p.buyCount, 2);
});

test("fee absolut per transaksi menggantikan persen", () => {
  const p = derivePositions([buy("BBRI", "2026-01-05", 2, 3000, { fee: 1000 })], FEES).get("BBRI")!;
  assert.equal(p.cost, 601_000);
});

test("jual sebagian: realized = hasil − fee jual − modal rata-rata lembar yang dijual", () => {
  const pos = derivePositions(
    [buy("BBCA", "2026-01-05", 2, 5000, { fee: 0 }), sell("BBCA", "2026-03-01", 1, 5500, { fee: 0 })],
    FEES,
  );
  const p = pos.get("BBCA")!;
  assert.equal(p.shares, 100);
  assert.equal(p.cost, 500_000, "modal sisa memakai harga rata-rata");
  assert.equal(p.realizedPnl, 50_000);
  assert.equal(p.sellCount, 1);
});

test("jual habis: posisi tertutup, realized memperhitungkan fee jual persen", () => {
  const p = derivePositions([buy("TLKM", "2026-01-05", 1, 3000, { fee: 0 }), sell("TLKM", "2026-02-01", 1, 2800)], FEES).get("TLKM")!;
  assert.equal(p.shares, 0);
  assert.equal(p.avgPrice, 0);
  // hasil 280.000 − fee 0,25% (700) − modal 300.000 = −20.700
  assert.equal(p.realizedPnl, -20_700);
});

test("jual melebihi kepemilikan → error yang jelas", () => {
  assert.throws(
    () => derivePositions([buy("BBCA", "2026-01-05", 1, 5000), sell("BBCA", "2026-01-06", 2, 5000)], FEES),
    /jual BBCA 2026-01-06.*2 lot.*hanya punya 1 lot/,
  );
  assert.throws(() => derivePositions([sell("BBCA", "2026-01-06", 1, 5000)], FEES), /hanya punya 0 lot/);
});

test("urutan: tanggal naik, pada hari yang sama beli diproses sebelum jual", () => {
  const sorted = sortTransactions([
    sell("BBCA", "2026-01-06", 1, 5000),
    buy("BBCA", "2026-01-06", 1, 5000),
    buy("BBCA", "2026-01-05", 1, 4000),
  ]);
  assert.deepEqual(sorted.map((t) => `${t.date}:${t.type}`), ["2026-01-05:buy", "2026-01-06:buy", "2026-01-06:sell"]);
  assert.doesNotThrow(() =>
    derivePositions(
      [sell("BBCA", "2026-01-06", 2, 5000), buy("BBCA", "2026-01-06", 1, 5000), buy("BBCA", "2026-01-05", 1, 4000)],
      FEES,
    ),
  );
});

test("dividen diterima: hanya lembar sebelum ex-date; beli tepat di ex-date tidak dapat; jual di ex-date masih dapat", () => {
  const txs = [
    buy("BBCA", "2025-11-01", 1, 7000),
    buy("BBCA", "2025-12-03", 1, 7100), // tepat di ex-date pertama → tidak dapat
    sell("BBCA", "2026-03-30", 1, 6500), // tepat di ex-date kedua → masih dapat untuk 2 lot
  ];
  const divs = [
    { date: "2025-10-01", amount: 99 }, // sebelum beli
    { date: "2025-12-03", amount: 55 },
    { date: "2026-03-30", amount: 281 },
    { date: "2026-06-17", amount: 20 },
  ];
  const r = dividendsReceived(txs, divs);
  assert.deepEqual(r.items, [
    { date: "2025-12-03", amountPerShare: 55, shares: 100, total: 5_500 },
    { date: "2026-03-30", amountPerShare: 281, shares: 200, total: 56_200 },
    { date: "2026-06-17", amountPerShare: 20, shares: 100, total: 2_000 },
  ]);
  assert.equal(r.total, 63_700);
});

test("derivePositions tidak mengubah input", () => {
  const txs = [buy("BBCA", "2026-01-05", 1, 4820)];
  const copy = JSON.stringify(txs);
  derivePositions(txs, FEES);
  assert.equal(JSON.stringify(txs), copy);
});
