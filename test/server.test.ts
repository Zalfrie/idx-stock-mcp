import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, splitCheckRange } from "../src/server.js";
import { YahooClient } from "../src/yahoo.js";
import { chartFixture, DAY, fakeFetch, MON_19_OCT_0900_WIB } from "./fixtures.js";

const NOW_MS = (MON_19_OCT_0900_WIB + 3600) * 1000; // Senin 19 Okt 2026 10:00 WIB

const defaultBodies = {
  "BBCA.JK": chartFixture("BBCA.JK", [6000, 5500, 5175, 4820], { adjClose: [5800, 5400, 5175, 4820] }),
  "BBRI.JK": chartFixture("BBRI.JK", [3000, 3100, 3200, 3300], { adjClose: [2800, 2950, 3100, 3300] }),
  "^JKSE": chartFixture("^JKSE", [6100, 6000, 5900, 5863]),
};

async function connect(opts: { portfolioPath?: string; bodies?: Record<string, unknown>; failing?: string[] } = {}) {
  const { impl } = fakeFetch(opts.bodies ?? defaultBodies, opts.failing ?? []);
  const yahoo = new YahooClient({ fetchImpl: impl, clock: () => NOW_MS });
  const server = createServer({ client: yahoo, portfolioPath: opts.portfolioPath });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function writePortfolio(data: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "idx-mcp-"));
  const path = join(dir, "portfolio.json");
  await writeFile(path, typeof data === "string" ? data : JSON.stringify(data));
  return path;
}

const parse = (r: any) => JSON.parse(r.content[0].text);

test("daftar tool yang tersedia, semuanya read-only", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["compare_stocks", "get_history", "get_portfolio", "get_quote"]);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
});

test("get_quote menyertakan status pasar dan catatan kesegaran", async () => {
  const client = await connect();
  const out = parse(await client.callTool({ name: "get_quote", arguments: { ticker: "bbca" } }));
  assert.equal(out.price, 4820);
  assert.equal(out.pricePerLot, 482000);
  assert.equal(out.changePct, -6.86);
  assert.equal(out.marketState, "open");
  assert.ok(out.freshnessNote.length > 0);
  assert.ok(out.dataAsOfLocal.endsWith("WIB"));
});

test("get_quote saham tidak dikenal -> isError", async () => {
  const client = await connect();
  const r: any = await client.callTool({ name: "get_quote", arguments: { ticker: "ZZZZ" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /tidak ditemukan/);
});

test("get_history memberi price & total return", async () => {
  const client = await connect();
  const out = parse(await client.callTool({ name: "get_history", arguments: { ticker: "BBCA", range: "1mo" } }));
  assert.equal(out.summary.priceReturnPct, -19.67);
  assert.equal(out.summary.totalReturnPct, -16.9);
  assert.equal(out.candles.length, 4);
  assert.ok(out.dataAsOf);
});

test("compare_stocks: pakai totalReturnPct bila tersedia untuk semua", async () => {
  const client = await connect();
  const out = parse(await client.callTool({ name: "compare_stocks", arguments: { tickers: ["BBCA", "BBRI"], range: "1mo" } }));
  assert.equal(out.rankedBy, "totalReturnPct");
  assert.deepEqual(out.ranked.map((r: any) => r.ticker), ["BBRI", "BBCA"]);
});

test("compare_stocks: turun ke priceReturnPct bila ada yang tanpa data dividen, ticker gagal tetap tampil", async () => {
  const bodies = { ...defaultBodies, "^JKSE": chartFixture("^JKSE", [6100, 6000, 5900, 5863], { adjClose: null }) };
  const client = await connect({ bodies });
  const out = parse(
    await client.callTool({ name: "compare_stocks", arguments: { tickers: ["BBCA", "BBRI", "IHSG", "ZZZZ"], range: "1mo" } }),
  );
  assert.equal(out.rankedBy, "priceReturnPct");
  assert.deepEqual(out.ranked.slice(0, 3).map((r: any) => r.ticker), ["BBRI", "^JKSE", "BBCA"]);
  assert.equal(out.ranked[3].ticker, "ZZZZ");
  assert.ok(out.ranked[3].error);
  assert.ok(out.notes.some((n: string) => /gagal/.test(n)));
});

// ---------- Poin 5 & 7: portofolio ----------

test("get_portfolio: perhitungan, asumsi fee, dan estimasi hasil jual", async () => {
  const path = await writePortfolio({
    sellFeePct: 0.25,
    holdings: [
      { ticker: "BBCA", lots: 1, avgPrice: 5000, buyDate: "2026-10-01" },
      { ticker: "bbri.jk", lots: 2, avgPrice: 3000, buyDate: "2026-10-01" },
    ],
    manual: [{ name: "RD indeks", invested: 500000, currentValue: 510000, updatedAt: "2026-10-18" }],
  });
  const client = await connect({ portfolioPath: path });
  const out = parse(await client.callTool({ name: "get_portfolio", arguments: {} }));
  const [bbca, bbri] = out.holdings;
  assert.equal(bbca.marketValue, 482000);
  assert.equal(bbca.unrealizedPnl, -18000);
  assert.equal(bbca.unrealizedPnlPct, -3.6);
  assert.equal(bbca.estimatedNetIfSold, 480795);
  assert.equal(bbri.ticker, "BBRI");
  assert.equal(bbri.unrealizedPnl, 60000);
  assert.equal(out.totals.cost, 1_600_000);
  assert.equal(out.totals.marketValue, 1_652_000);
  assert.equal(out.totals.unrealizedPnl, 52_000);
  assert.equal(out.totals.incomplete, false);
  assert.equal(out.assumptions.sellFeePct, 0.25);
  assert.match(out.assumptions.estimate, /perkiraan/);
  assert.deepEqual(out.warnings, []);
});

test("get_portfolio: saham gagal diambil TIDAK dihitung sebagai impas, dan diberi peringatan di urutan pertama", async () => {
  const path = await writePortfolio({
    holdings: [
      { ticker: "BBCA", lots: 1, avgPrice: 5000, buyDate: "2026-10-01" },
      { ticker: "TLKM", lots: 3, avgPrice: 3000, buyDate: "2026-10-01" },
    ],
  });
  const client = await connect({ portfolioPath: path, failing: ["TLKM.JK"] });
  const out = parse(await client.callTool({ name: "get_portfolio", arguments: {} }));
  assert.equal(out.totals.incomplete, true);
  assert.deepEqual(out.totals.excludedTickers, ["TLKM"]);
  assert.equal(out.totals.excludedCost, 900000);
  assert.equal(out.totals.cost, 500000, "modal TLKM tidak boleh ikut total");
  assert.equal(out.totals.marketValue, 482000);
  assert.equal(out.totals.unrealizedPnl, -18000);
  assert.equal(out.holdings[1].status, "unpriced");
  assert.match(out.warnings[0], /TIDAK LENGKAP: TLKM/);
});

// ---------- Poin 4: split setelah tanggal beli ----------

test("get_portfolio: split SETELAH tanggal beli → peringatan; split SEBELUM tanggal beli → tidak", async () => {
  const splitTs = MON_19_OCT_0900_WIB - 5 * DAY; // 14 Okt 2026
  const bodies = {
    ...defaultBodies,
    "BBCA.JK": chartFixture("BBCA.JK", [6000, 5500, 5175, 4820], {
      splits: [{ ts: splitTs, numerator: 5, denominator: 1 }],
    }),
  };
  const path = await writePortfolio({
    holdings: [
      { ticker: "BBCA", lots: 1, avgPrice: 24000, buyDate: "2026-10-01" },
      { ticker: "BBCA", lots: 1, avgPrice: 4900, buyDate: "2026-10-16", note: "beli setelah split" },
    ],
  });
  const client = await connect({ portfolioPath: path, bodies });
  const out = parse(await client.callTool({ name: "get_portfolio", arguments: {} }));
  assert.match(out.holdings[0].warnings[0], /stock split 5:1 pada 2026-10-14 \(setelah tanggal beli\)/);
  assert.deepEqual(out.holdings[1].warnings, []);
});

test("get_portfolio: tanpa buyDate → diberi tahu rentang pengecekan split", async () => {
  const path = await writePortfolio({ holdings: [{ ticker: "BBRI", lots: 1, avgPrice: 3000 }] });
  const client = await connect({ portfolioPath: path });
  const out = parse(await client.callTool({ name: "get_portfolio", arguments: {} }));
  assert.ok(out.warnings.some((w: string) => /buyDate untuk BBRI tidak diisi/.test(w)));
});

test("get_portfolio: nilai aset manual yang usang diberi peringatan", async () => {
  const path = await writePortfolio({
    manual: [
      { name: "RD lama", invested: 100000, currentValue: 90000, updatedAt: "2026-09-01" },
      { name: "RD tanpa tanggal", invested: 100000, currentValue: 100000 },
    ],
  });
  const client = await connect({ portfolioPath: path });
  const out = parse(await client.callTool({ name: "get_portfolio", arguments: {} }));
  assert.equal(out.manual[0].stale, true);
  assert.equal(out.manual[0].pnl, -10000);
  assert.ok(out.warnings.some((w: string) => /RD lama.*2026-09-01/.test(w)));
  assert.ok(out.warnings.some((w: string) => /RD tanpa tanggal.*tidak punya updatedAt/.test(w)));
});

test("splitCheckRange memilih rentang yang mencakup tanggal beli", () => {
  assert.equal(splitCheckRange(undefined, NOW_MS), "5y");
  assert.equal(splitCheckRange("2026-01-01", NOW_MS), "1y");
  assert.equal(splitCheckRange("2023-01-01", NOW_MS), "5y");
  assert.equal(splitCheckRange("2015-01-01", NOW_MS), "max");
});

test("get_portfolio: error konfigurasi diberi pesan jelas", async () => {
  const noPath = await connect();
  const r1: any = await noPath.callTool({ name: "get_portfolio", arguments: {} });
  assert.equal(r1.isError, true);
  assert.match(r1.content[0].text, /IDX_PORTFOLIO_PATH/);

  const bad = await connect({ portfolioPath: await writePortfolio("{ ini bukan json") });
  const r2: any = await bad.callTool({ name: "get_portfolio", arguments: {} });
  assert.match(r2.content[0].text, /bukan JSON/);

  const badDate = await connect({ portfolioPath: await writePortfolio({ holdings: [{ ticker: "BBCA", lots: 1, avgPrice: 1, buyDate: "19/10/2026" }] }) });
  const r3: any = await badDate.callTool({ name: "get_portfolio", arguments: {} });
  assert.match(r3.content[0].text, /YYYY-MM-DD/);
});
