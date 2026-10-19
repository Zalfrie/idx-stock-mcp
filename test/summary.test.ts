import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/summary.js";
import { parseChart } from "../src/yahoo.js";
import { chartFixture, DAY, MON_19_OCT_0900_WIB } from "./fixtures.js";

test("priceReturnPct vs totalReturnPct: dividen ikut dihitung di total return", () => {
  const chart = parseChart(
    chartFixture("BBRI.JK", [100, 100, 110], {
      adjClose: [90, 95, 110],
      dividends: [{ ts: MON_19_OCT_0900_WIB - DAY, amount: 5 }],
    }),
  );
  const s = summarize(chart)!;
  assert.equal(s.priceReturnPct, 10);
  assert.equal(s.totalReturnPct, 22.22);
  assert.equal(s.dividendsPerShareInRange, 5);
  assert.equal(s.dividendsInRange.length, 1);
  assert.match(s.notes[0], /priceReturnPct hanya menghitung perubahan harga/);
});

test("totalReturnPct null + catatan jika adjclose tidak tersedia", () => {
  const s = summarize(parseChart(chartFixture("BBCA.JK", [100, 120], { adjClose: null })))!;
  assert.equal(s.priceReturnPct, 20);
  assert.equal(s.totalReturnPct, null);
  assert.ok(s.notes.some((n) => /tidak dapat dihitung/.test(n)));
});

test("split dalam rentang dicatat dan drawdown memakai harga disesuaikan", () => {
  // Harga mentah turun 500 → 100 karena split 5:1, harga disesuaikan tetap datar.
  const chart = parseChart(
    chartFixture("XYZA.JK", [500, 500, 100, 102], {
      adjClose: [100, 100, 100, 102],
      splits: [{ ts: MON_19_OCT_0900_WIB - DAY, numerator: 5, denominator: 1 }],
    }),
  );
  const s = summarize(chart)!;
  assert.deepEqual(s.splitsInRange, [{ date: "2026-10-18", ratio: "5:1" }]);
  assert.equal(s.maxDrawdownPct, 0, "split tidak boleh terbaca sebagai anjlok 80%");
  assert.equal(s.totalReturnPct, 2);
  assert.ok(s.notes.some((n) => /stock split/.test(n)));
});

test("summarize mengembalikan null bila tidak ada harga", () => {
  assert.equal(summarize({ candles: [], dividends: [], splits: [] }), null);
});
