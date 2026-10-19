import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTicker, parseChart, YahooClient, type FetchLike } from "../src/yahoo.js";
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

// ---------- Issue #1: indeks tidak diperdagangkan per lot ----------

test("pricePerLot null untuk indeks, tetap terisi untuk saham", () => {
  const idx = parseChart(chartFixture("^JKSE", [5185.1, 4996.6])).quote;
  assert.equal(idx.pricePerLot, null);
  const stock = parseChart(chartFixture("BBCA.JK", [5000, 4820])).quote;
  assert.equal(stock.pricePerLot, 482000);
});

// ---------- Issue #1: jeda siang BEI ----------

test("jeda siang Senin–Kamis: status tetap open, catatan menyebut jeda siang (bukan hari libur)", () => {
  const MON_1230_WIB_MS = (MON_19_OCT_0900_WIB + 3.5 * 3600) * 1000;
  // Harga terakhir 11:59 WIB (akhir sesi 1); sekarang 12:30 → umur data 31 menit.
  const fx = chartFixture("BBCA.JK", [5000, 4820], { marketTime: MON_19_OCT_0900_WIB + 3 * 3600 - 60 });
  const { quote } = parseChart(fx, { now: MON_1230_WIB_MS });
  assert.equal(quote.marketState, "open");
  assert.match(quote.freshnessNote, /jeda siang.*13:30 WIB/);
  assert.doesNotMatch(quote.freshnessNote, /hari libur/);
});

test("jeda siang Jumat 11:30–14:00; setelah jeda kembali 'Pasar sedang buka'", () => {
  const fri = MON_19_OCT_0900_WIB - 3 * DAY;
  const friFx = chartFixture("BBCA.JK", [5000, 4820], {
    lastCandleTs: fri,
    marketTime: fri + 2.5 * 3600, // Jumat 11:30
    tradingPeriod: { start: fri, end: fri + 7 * 3600 },
  });
  const atBreak = parseChart(friFx, { now: (fri + 3 * 3600) * 1000 }).quote; // Jumat 12:00
  assert.match(atBreak.freshnessNote, /jeda siang.*14:00 WIB/);

  const monTs = MON_19_OCT_0900_WIB + 4.75 * 3600; // Senin 13:45
  const after = parseChart(chartFixture("BBCA.JK", [5000, 4820], { marketTime: monTs }), { now: (monTs + 60) * 1000 }).quote;
  assert.match(after.freshnessNote, /Pasar sedang buka/);
});

// ---------- Issue #1: pesan error jaringan dalam Bahasa Indonesia ----------

test("YahooClient: error jaringan, timeout, respons bukan JSON, dan 429 diberi pesan jelas", async () => {
  const mk = (fetchImpl: FetchLike) => new YahooClient({ fetchImpl, timeoutMs: 10_000 });
  await assert.rejects(
    mk(async () => { throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }); }).quote("BBCA"),
    /Tidak dapat terhubung ke Yahoo Finance \(ENOTFOUND\)/,
  );
  await assert.rejects(
    mk(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }).quote("BBCA"),
    /tidak merespons dalam 10 detik/,
  );
  await assert.rejects(mk(async () => new Response("<html>consent</html>", { status: 200 })).quote("BBCA"), /bukan JSON/);
  await assert.rejects(
    mk(async () => new Response("", { status: 429, statusText: "Too Many Requests" })).quote("BBCA"),
    /Terlalu banyak permintaan.*429/,
  );
});

test("jeda siang tidak menutupi harga basi: data dari hari sebelumnya tetap diberi peringatan", () => {
  const fri = MON_19_OCT_0900_WIB - 3 * DAY;
  const fx = chartFixture("BBCA.JK", [5000, 4820], { lastCandleTs: fri, marketTime: fri + 7 * 3600 }); // Jumat 16:00
  const { quote } = parseChart(fx, { now: (MON_19_OCT_0900_WIB + 3.5 * 3600) * 1000 }); // Senin 12:30
  assert.equal(quote.marketState, "open");
  assert.doesNotMatch(quote.freshnessNote, /jeda siang/);
  assert.match(quote.freshnessNote, /seharusnya buka.*hari libur/);
});

// ---------- Retry + backoff saat Yahoo 429 / 5xx / error jaringan ----------

function sequencedFetch(responses: (() => Response)[]) {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    const make = responses[Math.min(calls.length, responses.length - 1)];
    calls.push(url);
    return make();
  };
  return { impl, calls };
}
const okResponse = () => new Response(JSON.stringify(chartFixture("BBCA.JK", [5000, 4820])), { status: 200 });
const tooManyResponse = (retryAfter?: string) =>
  new Response("", { status: 429, statusText: "Too Many Requests", headers: retryAfter ? { "Retry-After": retryAfter } : {} });
const noSleep = async () => {};

test("retry: 429 lalu 200 → berhasil dengan 2 panggilan, jeda memakai backoff", async () => {
  const sleeps: number[] = [];
  const { impl, calls } = sequencedFetch([tooManyResponse, okResponse]);
  const client = new YahooClient({ fetchImpl: impl, sleepImpl: async (ms) => { sleeps.push(ms); }, retryBaseMs: 500 });
  const q = await client.quote("BBCA");
  assert.equal(q.price, 4820);
  assert.equal(calls.length, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 500 && sleeps[0] < 1000, `jeda pertama ${sleeps[0]}ms harus di [500, 1000)`);
});

test("retry: 429 terus → gagal setelah maxRetries+1 panggilan dengan pesan 429", async () => {
  const { impl, calls } = sequencedFetch([tooManyResponse]);
  const client = new YahooClient({ fetchImpl: impl, sleepImpl: noSleep, maxRetries: 2 });
  await assert.rejects(client.quote("BBCA"), /Terlalu banyak permintaan.*429.*3 kali/);
  assert.equal(calls.length, 3);
});

test("retry: 404 dan respons bukan JSON tidak di-retry", async () => {
  const nf = sequencedFetch([() => new Response(JSON.stringify(notFoundFixture()), { status: 404 })]);
  await assert.rejects(new YahooClient({ fetchImpl: nf.impl, sleepImpl: noSleep }).quote("XXXX"), /tidak ditemukan/);
  assert.equal(nf.calls.length, 1);

  const html = sequencedFetch([() => new Response("<html>", { status: 200 })]);
  await assert.rejects(new YahooClient({ fetchImpl: html.impl, sleepImpl: noSleep }).quote("BBCA"), /bukan JSON/);
  assert.equal(html.calls.length, 1);
});

test("retry: header Retry-After (detik) dihormati, dibatasi maksimum", async () => {
  const sleeps: number[] = [];
  const { impl } = sequencedFetch([() => tooManyResponse("3"), okResponse]);
  await new YahooClient({ fetchImpl: impl, sleepImpl: async (ms) => { sleeps.push(ms); } }).quote("BBCA");
  assert.deepEqual(sleeps, [3000]);

  const longSleeps: number[] = [];
  const long = sequencedFetch([() => tooManyResponse("3600"), okResponse]);
  await new YahooClient({ fetchImpl: long.impl, sleepImpl: async (ms) => { longSleeps.push(ms); } }).quote("BBCA");
  assert.ok(longSleeps[0] <= 15_000, `Retry-After 3600 detik harus dibatasi, dapat ${longSleeps[0]}ms`);
});

test("retry: 5xx dan error jaringan sementara juga di-retry", async () => {
  let n = 0;
  const impl: FetchLike = async () => {
    n++;
    if (n === 1) throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    if (n === 2) return new Response("", { status: 503, statusText: "Service Unavailable" });
    return okResponse();
  };
  const client = new YahooClient({ fetchImpl: impl, sleepImpl: noSleep, maxRetries: 2 });
  assert.equal((await client.quote("BBCA")).price, 4820);
  assert.equal(n, 3);
});

test("retry: maxRetries 0 mematikan retry", async () => {
  const { impl, calls } = sequencedFetch([tooManyResponse, okResponse]);
  await assert.rejects(new YahooClient({ fetchImpl: impl, sleepImpl: noSleep, maxRetries: 0 }).quote("BBCA"), /429/);
  assert.equal(calls.length, 1);
});
