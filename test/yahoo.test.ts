import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTicker, parseChart, YahooClient } from "../src/yahoo.js";
import { chartFixture, fakeFetch, notFoundFixture } from "./fixtures.js";

test("normalizeTicker menambah .JK dan mengenali alias indeks", () => {
  assert.equal(normalizeTicker("bbca"), "BBCA.JK");
  assert.equal(normalizeTicker(" BBRI.jk "), "BBRI.JK");
  assert.equal(normalizeTicker("IHSG"), "^JKSE");
  assert.equal(normalizeTicker("^JKSE"), "^JKSE");
  assert.throws(() => normalizeTicker(""), /kosong/);
  assert.throws(() => normalizeTicker("BB CA"), /tidak valid/);
});

test("parseChart: previousClose dari candle sebelumnya, bukan chartPreviousClose", () => {
  const { quote, candles } = parseChart(chartFixture("BBCA.JK", [6000, 5950, 5175, 4820]));
  assert.equal(quote.ticker, "BBCA");
  assert.equal(quote.price, 4820);
  assert.equal(quote.previousClose, 5175);
  assert.equal(quote.change, -355);
  assert.equal(quote.changePct, -6.86);
  assert.equal(quote.pricePerLot, 482000);
  assert.equal(candles.length, 4);
  assert.match(candles[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test("parseChart: meta.previousClose diutamakan jika ada", () => {
  const { quote } = parseChart(chartFixture("BBCA.JK", [4820], { previousClose: 5175 }));
  assert.equal(quote.previousClose, 5175);
});

test("parseChart: error dari Yahoo dilempar dengan pesan jelas", () => {
  assert.throws(() => parseChart(notFoundFixture()), /No data found/);
});

test("YahooClient memakai cache untuk permintaan yang sama", async () => {
  const { impl, calls } = fakeFetch({ "BBCA.JK": chartFixture("BBCA.JK", [5000, 4820]) });
  const client = new YahooClient({ fetchImpl: impl });
  await client.quote("BBCA");
  await client.quote("bbca");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /BBCA\.JK\?range=5d&interval=1d/);
});

test("YahooClient: saham tidak dikenal menghasilkan error 'tidak ditemukan'", async () => {
  const { impl } = fakeFetch({});
  const client = new YahooClient({ fetchImpl: impl });
  await assert.rejects(client.quote("XXXX"), /tidak ditemukan/);
});
