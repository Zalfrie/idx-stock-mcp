# Changelog

Semua perubahan penting dicatat di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/),
versi mengikuti [Semantic Versioning](https://semver.org/lang/id/).

## [1.1.1] - 2026-10-19

Hasil audit dan tes data live pertama sebelum repo dipublikasikan ([#1](https://github.com/Zalfrie/idx-stock-mcp/issues/1)).

### Diperbaiki
- `get_quote`: `pricePerLot` kini `null` untuk indeks (IHSG/`^JKSE`). Sebelumnya dihitung dari nilai indeks × 100 dan tidak bermakna.
- `freshnessNote`: jeda siang BEI (Sen–Kam 12:00–13:30, Jum 11:30–14:00 WIB) dikenali. Sebelumnya saat jeda muncul
  peringatan keliru "bisa jadi hari libur bursa, saham disuspensi, atau data tertunda". `marketState` tetap `open`.
- Pesan error jaringan kini dalam Bahasa Indonesia dan menyebut penyebabnya: tidak bisa terhubung (DNS/koneksi),
  timeout, respons bukan JSON, dan HTTP 429. Sebelumnya pengguna melihat `fetch failed` atau
  `The operation was aborted due to timeout`.
- Skrip `npm test` memakai daftar file eksplisit, sehingga lulus di Windows + Node 20 (cmd.exe tidak mengekspansi glob,
  dan Node 20 belum mendukung glob di `--test`).

### Diubah
- `package.json`: tambah `author`, `repository`, `bugs`, `homepage`, dan kata kunci.
- README: status verifikasi live, arti `tradingDays` untuk interval mingguan/bulanan, entri troubleshooting baru.

### Breaking change
- Tipe `pricePerLot` di `get_quote` berubah dari `number` menjadi `number | null` (hanya `null` untuk indeks).

## [1.1.0] - 2026-10-19

### Diperbaiki (integritas data)
- Penutupan kemarin ditentukan dari tanggal harga terkini, bukan `chartPreviousClose` (yang merupakan penutupan sebelum awal rentang).
- Saham yang gagal diambil harganya **tidak** dihitung impas: dikeluarkan dari total (`excludedTickers`, `totals.incomplete`) dengan peringatan di urutan pertama.

### Ditambahkan
- `get_quote`: `marketState`, `dataAsOfLocal` (WIB), `dataAgeMinutes`, `freshnessNote`.
- `get_history` / `compare_stocks`: `totalReturnPct` (termasuk dividen), `dividendsInRange`, `splitsInRange`, `rankedBy`.
- `get_portfolio`: peringatan stock split setelah `buyDate`, peringatan nilai aset manual yang usang (`manualStaleDays`), `assumptions`, `estimatedNetIfSold`.
- CI (Node 20 & 22), integrasi `@claude`, template issue/PR, CONTRIBUTING.md, CLAUDE.md.

### Dihapus
- Alias `LQ45` karena simbol Yahoo-nya belum terverifikasi.

## [1.0.0]

Rilis awal: `get_quote`, `get_history`, `compare_stocks`, `get_portfolio` dengan sumber data Yahoo Finance.
