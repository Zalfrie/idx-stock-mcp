import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { YahooClient } from "../src/yahoo.js";
import { chartFixture, fakeFetch } from "./fixtures.js";

async function connect(portfolioPath?: string) {
  const { impl } = fakeFetch({
    "BBCA.JK": chartFixture("BBCA.JK", [6000, 5500, 5175, 4820]),
    "BBRI.JK": chartFixture("BBRI.JK", [3000, 3100, 3200, 3300]),
    "^JKSE": chartFixture("^JKSE", [6100, 6000, 5900, 5863]),
  });
  const server = createServer({ client: new YahooClient({ fetchImpl: impl }), portfolioPath });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const parse = (r: any) => JSON.parse(r.content[0].text);

test("daftar tool yang tersedia", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["compare_stocks", "get_history", "get_portfolio", "get_quote"]);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
});

test("get_quote", async () => {
  const client = await connect();
  const out = parse(await client.callTool({ name: "get_quote", arguments: { ticker: "bbca" } }));
  assert.equal(out.price, 4820);
  assert.equal(out.pricePerLot, 482000);
  assert.equal(out.changePct, -6.86);
});

test("get_quote saham tidak dikenal -> isError", async () => {
  const client = await connect();
  const r: any = await client.callTool({ name: "get_quote", arguments: { ticker: "ZZZZ" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /tidak ditemukan/);
});

test("get_history memberi ringkasan performa", async () => {
  const client = await connect();
  const out = parse(await client.callTool({ name: "get_history", arguments: { ticker: "BBCA", range: "1mo" } }));
  assert.equal(out.summary.startClose, 6000);
  assert.equal(out.summary.endClose, 4820);
  assert.equal(out.summary.returnPct, -19.67);
  assert.equal(out.summary.maxDrawdownPct, -19.67);
  assert.equal(out.candles.length, 4);
});

test("compare_stocks mengurutkan berdasarkan return dan menangani ticker gagal", async () => {
  const client = await connect();
  const out = parse(
    await client.callTool({ name: "compare_stocks", arguments: { tickers: ["BBCA", "BBRI", "IHSG", "ZZZZ"], range: "1mo" } }),
  );
  assert.deepEqual(out.ranked.slice(0, 3).map((r: any) => r.ticker), ["BBRI", "^JKSE", "BBCA"]);
  assert.equal(out.ranked[3].ticker, "ZZZZ");
  assert.ok(out.ranked[3].error);
});

test("get_portfolio menghitung untung/rugi dan fee jual", async () => {
  const dir = await mkdtemp(join(tmpdir(), "idx-mcp-"));
  const path = join(dir, "portfolio.json");
  await writeFile(
    path,
    JSON.stringify({
      sellFeePct: 0.25,
      holdings: [
        { ticker: "BBCA", lots: 1, avgPrice: 5000 },
        { ticker: "bbri.jk", lots: 2, avgPrice: 3000 },
      ],
      manual: [{ name: "RD indeks", invested: 500000, currentValue: 510000 }],
    }),
  );
  const client = await connect(path);
  const out = parse(await client.callTool({ name: "get_portfolio", arguments: {} }));
  const [bbca, bbri] = out.holdings;
  assert.equal(bbca.marketValue, 482000);
  assert.equal(bbca.unrealizedPnl, -18000);
  assert.equal(bbca.unrealizedPnlPct, -3.6);
  assert.equal(bbri.ticker, "BBRI");
  assert.equal(bbri.marketValue, 660000);
  assert.equal(bbri.unrealizedPnl, 60000);
  // total: biaya 500.000 + 600.000 + 500.000; nilai 482.000 + 660.000 + 510.000
  assert.equal(out.totals.cost, 1_600_000);
  assert.equal(out.totals.marketValue, 1_652_000);
  assert.equal(out.totals.unrealizedPnl, 52_000);
  assert.equal(out.totals.estNetIfSold, 1_652_000 - (482000 + 660000) * 0.0025);
  assert.equal(out.totals.incomplete, false);
});

test("get_portfolio tanpa IDX_PORTFOLIO_PATH -> pesan jelas", async () => {
  const client = await connect();
  const r: any = await client.callTool({ name: "get_portfolio", arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /IDX_PORTFOLIO_PATH/);
});

test("get_portfolio file JSON rusak -> pesan jelas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "idx-mcp-"));
  const path = join(dir, "bad.json");
  await writeFile(path, "{ ini bukan json");
  const client = await connect(path);
  const r: any = await client.callTool({ name: "get_portfolio", arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /bukan JSON/);
});
