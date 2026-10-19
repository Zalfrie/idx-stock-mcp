import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTicker, parseChart, YahooClient } from "../src/yahoo.js";
import { chartFixture, DAY, fakeFetch, MON_19_OCT_0900_WIB, notFoundFixture } from "./fixtures.js";

const MON_1000_WIB_MS = (MON_19_OCT_0900_WIB + 3600) * 1000;
const SAT_1000_WIB_MS = MON_1000_WIB_MS - 2 * DAY * 1000;

test("normalizeTicker menambah .JK dan mengenali alias IHSG", () => {
  assert.equal(normalizeTicker("bbca"), "BBCA.JK");
  assert.equal(normalizeTicker(" BBRI.jk "), "BBRI.JK");
  assert.equal(normalizeTicker("IHSG"), "^JKSE");
  assert.equal(normalizeTicker("^JKSE"), "^JKSE");
  assert.throws(() => normalizeTicker(""), /kosong/);
  assert.throws(() => normalizeTicker("BB CA"), /tidak valid/);
  assert.throws(() => normalizeTicker("^JK/../x"), /tidak valid/);
});

// ---------- Poin 2: penutupan kemarin ----------

test("previousClose: candle hari ini sudah ada → pakai candle sebelumnya", () => {
  const { quote } = parseChart(chartFixture("BBCA.JK", [6000, 5950, 5175, 4820]), { now: MON_1000_WIB_MS });
  assert.equal(quote.previousClose, 5175);
  assert.equal(quote.previousCloseSource, "candle");
  assert.equal(quote.change, -355);
  assert.equal(quote.changePct, -6.86);
  assert.equal(quote.pricePerLot, 482000);
});

test("previousClose: candle hari ini BELUM muncul → candle terakhir adalah penutupan kemarin", () => {
  // Candle terakhir Jumat 16 Okt; harga terkini (4820) bertanggal Senin 19 Okt.
  const fri = MON_19_OCT_0900_WIB - 3 * DAY;
  const fx = chartFixture("BBCA.JK", [6000, 5950, 5175], {
    lastCandleTs: fri,
    price: 4820,
    marketTime: MON_19_OCT_0900_WIB + 1800,
  });
  const { quote } = parseChart(fx, { now: MON_1000_WIB_MS });
  assert.equal(quote.price, 4820);
  assert.equal(quote.previousClose, 5175, "harus dibanding Jumat, bukan Kamis");
  assert.equal(quote.changePct, -6.86);
});

test("previousClose: meta.previousClose diutamakan; chartPreviousClose tidak pernah dipakai", () => {
  const a = parseChart(chartFixture("BBCA.JK", [4820], { previousClose: 5175 })).quote;
  assert.equal(a.previousClose, 5175);
  assert.equal(a.previousCloseSource, "meta.previousClose");
  const b = parseChart(chartFixture("BBCA.JK", [4820])).quote; // hanya 1 candle, chartPreviousClose=9999
  assert.equal(b.previousClose, null);
  assert.equal(b.previousCloseSource, "unavailable");
  assert.equal(b.changePct, null);
});

// ---------- Poin 6: status pasar & kesegaran data ----------

test("marketState open: dalam currentTradingPeriod dan data segar", () => {
  const fx = chartFixture("BBCA.JK", [5000, 4820], { marketTime: MON_19_OCT_0900_WIB + 3500 });
  const { quote } = parseChart(fx, { now: MON_1000_WIB_MS });
  assert.equal(quote.marketState, "open");
  assert.equal(quote.dataAgeMinutes, 2);
  assert.equal(quote.dataAsOfLocal, "Sen, 19 Okt 2026 09:58 WIB");
  assert.match(quote.freshnessNote, /Pasar sedang buka/);
});

test("marketState open tapi harga tidak bergerak lama → diberi peringatan", () => {
  const fx = chartFixture("BBCA.JK", [5000, 4820], {
    lastCandleTs: MON_19_OCT_0900_WIB - 3 * DAY,
    marketTime: MON_19_OCT_0900_WIB - 3 * DAY + 7 * 3600, // Jumat 16:00
  });
  const { quote } = parseChart(fx, { now: MON_1000_WIB_MS });
  assert.equal(quote.marketState, "open");
  assert.match(quote.freshnessNote, /seharusnya buka.*hari libur/);
});

test("marketState closed di akhir pekan, catatan menyebut penutupan terakhir", () => {
  const fri = MON_19_OCT_0900_WIB - 3 * DAY;
  const fx = chartFixture("BBCA.JK", [5000, 5175], {
    lastCandleTs: fri,
    tradingPeriod: { start: fri, end: fri + 7 * 3600 },
  });
  const { quote } = parseChart(fx, { now: SAT_1000_WIB_MS });
  assert.equal(quote.marketState, "closed");
  assert.match(quote.freshnessNote, /Pasar sedang tutup.*Jum, 16 Okt 2026 16:00 WIB/);
});

test("tanpa currentTradingPeriod: akhir pekan = closed, jam bursa hari kerja = unknown", () => {
  const fx = chartFixture("BBCA.JK", [5000, 4820], { tradingPeriod: null });
  assert.equal(parseChart(fx, { now: SAT_1000_WIB_MS }).quote.marketState, "closed");
  assert.equal(parseChart(fx, { now: MON_1000_WIB_MS }).quote.marketState, "unknown");
});

// ---------- Poin 3 & 4: event dividen dan split ----------

test("parseChart membaca dividen, split, dan adjclose", () => {
  const fx = chartFixture("BBCA.JK", [100, 100, 110], {
    adjClose: [90, 95, 110],
    dividends: [{ ts: MON_19_OCT_0900_WIB - DAY, amount: 5 }],
    splits: [{ ts: MON_19_OCT_0900_WIB, numerator: 5, denominator: 1 }],
  });
  const r = parseChart(fx);
  assert.deepEqual(r.dividends, [{ date: "2026-10-18", amount: 5 }]);
  assert.deepEqual(r.splits, [{ date: "2026-10-19", numerator: 5, denominator: 1, ratio: "5:1" }]);
  assert.equal(r.candles[0].adjClose, 90);
});

test("parseChart: error dari Yahoo dilempar dengan pesan jelas", () => {
  assert.throws(() => parseChart(notFoundFixture()), /No data found/);
});

test("YahooClient memakai cache dan meminta event dividen/split", async () => {
  const { impl, calls } = fakeFetch({ "BBCA.JK": chartFixture("BBCA.JK", [5000, 4820]) });
  const client = new YahooClient({ fetchImpl: impl });
  await client.quote("BBCA");
  await client.quote("bbca");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /BBCA\.JK\?range=5d&interval=1d&includePrePost=false&events=div%2Csplit/);
});

test("YahooClient: cache kedaluwarsa mengikuti clock", async () => {
  let now = 0;
  const { impl, calls } = fakeFetch({ "BBCA.JK": chartFixture("BBCA.JK", [5000, 4820]) });
  const client = new YahooClient({ fetchImpl: impl, clock: () => now, cacheTtlMs: 60_000 });
  await client.quote("BBCA");
  now = 61_000;
  await client.quote("BBCA");
  assert.equal(calls.length, 2);
});

test("YahooClient: saham tidak dikenal menghasilkan error 'tidak ditemukan'", async () => {
  const { impl } = fakeFetch({});
  const client = new YahooClient({ fetchImpl: impl });
  await assert.rejects(client.quote("XXXX"), /tidak ditemukan/);
});
