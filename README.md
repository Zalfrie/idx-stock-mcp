# idx-stock-mcp

[![CI](https://github.com/Zalfrie/idx-stock-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Zalfrie/idx-stock-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js ≥20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)

MCP server agar Claude bisa membaca harga saham **Bursa Efek Indonesia (IDX/BEI)**, membandingkan performa saham, dan menghitung nilai portofolio pribadi Anda langsung dari percakapan.

> ⚠️ Server ini **hanya membaca data**. Tidak ada fitur beli/jual dan tidak terhubung ke akun sekuritas mana pun (Bibit, Stockbit, Ajaib, dll). Data untuk informasi, bukan rekomendasi investasi.

> 🧪 **Status:** parser data sudah diuji dengan 30 test memakai data tiruan berformat respons Yahoo Finance. Verifikasi dengan data live sedang berjalan. Jika menemukan angka yang berbeda dengan aplikasi sekuritas Anda, mohon [laporkan](https://github.com/Zalfrie/idx-stock-mcp/issues/new/choose).

## Daftar isi

- [Fitur](#fitur)
- [Cara pakai (langkah demi langkah)](#cara-pakai-langkah-demi-langkah)
  - [1. Persiapan](#1-persiapan)
  - [2. Download & build](#2-download--build)
  - [3. Siapkan file portofolio](#3-siapkan-file-portofolio-opsional)
  - [4. Hubungkan ke Claude](#4-hubungkan-ke-claude)
  - [5. Mulai bertanya](#5-mulai-bertanya)
- [Format file portofolio](#format-file-portofolio)
- [Referensi tools](#referensi-tools)
- [Troubleshooting](#troubleshooting)
- [Sumber data & batasan](#sumber-data--batasan)
- [Pengembangan](#pengembangan)
- [Kontribusi](#kontribusi)

## Fitur

| Tool | Fungsi |
| --- | --- |
| `get_quote` | Harga terakhir, perubahan harian, rentang 52 minggu, dan harga per lot (100 lembar), lengkap dengan **status pasar** (buka/tutup) dan **waktu data dalam WIB**. |
| `get_history` | Riwayat harga (OHLC + volume) dengan return **harga saja** dan **total return termasuk dividen**, daftar dividen & stock split, tertinggi, terendah, dan max drawdown. |
| `compare_stocks` | Bandingkan 2–10 saham/indeks pada rentang waktu yang sama, diurutkan berdasarkan total return (atau return harga jika data dividen tidak lengkap). |
| `get_portfolio` | Hitung nilai portofolio Anda: untung/rugi per saham dan total, estimasi hasil bersih setelah fee jual, serta **peringatan** jika data tidak lengkap, ada stock split, atau nilai reksa dana sudah lama tidak diperbarui. |

Prinsipnya: **lebih baik memberi peringatan daripada angka yang terlihat valid padahal tidak.**

Kode saham bisa ditulis `BBCA`, `bbca`, atau `BBCA.JK`. Untuk indeks gunakan `IHSG`.

## Cara pakai (langkah demi langkah)

### 1. Persiapan

- **Node.js 20 atau lebih baru.** Cek dengan `node -v`. Download di <https://nodejs.org>.
- **Git** (untuk clone repo).
- **Claude Desktop** atau **Claude Code** di komputer Anda.

### 2. Download & build

```bash
git clone https://github.com/Zalfrie/idx-stock-mcp.git
cd idx-stock-mcp
npm install
npm run build
```

Opsional, pastikan semuanya berjalan:

```bash
npm test          # menjalankan unit test (tanpa internet)
npm run inspect   # membuka MCP Inspector di browser untuk mencoba tools dengan data live
```

Di MCP Inspector, klik **Connect** → tab **Tools** → pilih `get_quote` → isi `ticker` dengan `BBCA` → **Run Tool**. Kalau harga muncul, server siap dipakai.

### 3. Siapkan file portofolio (opsional)

Lewati langkah ini jika Anda hanya ingin melihat harga saham.

```bash
cp portfolio.example.json portfolio.json
```

Lalu edit `portfolio.json` sesuai kepemilikan Anda (lihat [format lengkapnya](#format-file-portofolio)). File ini sudah masuk `.gitignore`, jadi tidak akan ikut ter-commit.

Dua field yang sering terlewat:

- **`buyDate`** (`YYYY-MM-DD`) di setiap saham. Dipakai untuk mendeteksi stock split setelah Anda membeli. Tanpa field ini, Anda akan mendapat peringatan setiap kali melihat portofolio.
- **`updatedAt`** (`YYYY-MM-DD`) di setiap aset `manual` (mis. reksa dana). Perbarui setiap kali Anda mengubah `currentValue`. Jika lebih dari 7 hari (atau kosong), nilai tersebut ditandai usang.

Catat **path lengkap** foldernya, karena dibutuhkan di langkah berikutnya. Jalankan `pwd` (macOS/Linux) atau `cd` (Windows) di dalam folder repo.

### 4. Hubungkan ke Claude

#### Opsi A — Claude Desktop

1. Buka Claude Desktop → **Settings** → **Developer** → **Edit Config**. Ini membuka file `claude_desktop_config.json`:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. Tambahkan konfigurasi berikut (ganti path sesuai lokasi repo Anda):

   **macOS / Linux**
   ```json
   {
     "mcpServers": {
       "idx-stock": {
         "command": "node",
         "args": ["/Users/nama/idx-stock-mcp/dist/index.js"],
         "env": {
           "IDX_PORTFOLIO_PATH": "/Users/nama/idx-stock-mcp/portfolio.json"
         }
       }
     }
   }
   ```

   **Windows** (gunakan `\\` pada path)
   ```json
   {
     "mcpServers": {
       "idx-stock": {
         "command": "node",
         "args": ["C:\\Users\\nama\\idx-stock-mcp\\dist\\index.js"],
         "env": {
           "IDX_PORTFOLIO_PATH": "C:\\Users\\nama\\idx-stock-mcp\\portfolio.json"
         }
       }
     }
   }
   ```

   Jika file config sudah berisi server lain, tambahkan `"idx-stock": {...}` di dalam `mcpServers` yang sudah ada.
3. **Tutup Claude Desktop sepenuhnya** (quit, bukan hanya menutup jendela), lalu buka lagi.
4. Di kotak chat, klik ikon tools/connector. `idx-stock` dengan 4 tools harus muncul di sana.

#### Opsi B — Claude Code

```bash
claude mcp add idx-stock \
  -e IDX_PORTFOLIO_PATH=/path/lengkap/idx-stock-mcp/portfolio.json \
  -- node /path/lengkap/idx-stock-mcp/dist/index.js
```

Cek dengan `claude mcp list`, atau ketik `/mcp` di dalam sesi Claude Code.

#### Pastikan sudah terhubung dengan benar

Buka chat baru dan tanyakan:

> Berapa harga BBCA sekarang?

Jawaban yang benar menyebut **harga**, **waktu data dalam WIB**, dan **status pasar** (buka/tutup). Contohnya: "...per Sen, 19 Okt 2026 16:00 WIB, pasar sedang tutup". Jika Claude menjawab tanpa memanggil tool `get_quote`, atau tidak menyebut waktu data, kemungkinan server belum terhubung. Lihat [Troubleshooting](#troubleshooting).

### 5. Mulai bertanya

Cukup bertanya dengan bahasa biasa, dan Claude akan memanggil tool yang sesuai.

| Anda bertanya | Tool yang dipakai |
| --- | --- |
| "Berapa harga BBCA sekarang? 1 lotnya berapa?" | `get_quote` |
| "Bagaimana kondisi IHSG hari ini?" | `get_quote` |
| "Pasar sudah buka belum? Harga BBRI ini data jam berapa?" | `get_quote` |
| "Tunjukkan pergerakan TLKM 1 tahun terakhir, turunnya paling dalam berapa persen?" | `get_history` |
| "Berapa total return BBRI setahun terakhir termasuk dividen? Dividennya berapa per lembar?" | `get_history` |
| "Bandingkan BBCA, BBRI, BMRI, dan IHSG selama 6 bulan." | `compare_stocks` |
| "Bank mana yang paling tahan banting tahun ini?" | `compare_stocks` |
| "Berapa nilai portofolio saya hari ini? Untung atau rugi?" | `get_portfolio` |
| "Kalau semua saham saya jual sekarang, dapat bersih berapa?" | `get_portfolio` |
| "Ada peringatan apa di portofolio saya?" | `get_portfolio` |

Tips:

- Sebutkan rentang waktu kalau perlu: `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `ytd`, `max`.
- Setelah membeli atau menjual saham, **update `portfolio.json`**. Server membaca file ini setiap kali dipanggil, jadi tidak perlu restart.
- Untuk reksa dana Bibit, update nilai `currentValue` dan `updatedAt` di bagian `manual` sesekali, misalnya seminggu sekali, sesuai angka di aplikasi.
- Untuk membandingkan saham yang rutin membagi dividen (mis. saham bank), minta Claude memakai **total return**, bukan hanya perubahan harga.
- Jika Claude menyebut "Total TIDAK LENGKAP", ada saham yang harganya gagal diambil dan tidak ikut dihitung. Coba lagi beberapa saat kemudian.

## Format file portofolio

```json
{
  "sellFeePct": 0.25,
  "holdings": [
    { "ticker": "BBCA", "lots": 1, "avgPrice": 4820, "buyDate": "2026-10-19", "note": "beli pertama" },
    { "ticker": "BBRI", "lots": 2, "avgPrice": 3500, "buyDate": "2026-10-20" }
  ],
  "manual": [
    { "name": "Reksa dana indeks IDX30 (Bibit)", "invested": 500000, "currentValue": 512000, "updatedAt": "2026-10-19" }
  ]
}
```

| Field | Keterangan |
| --- | --- |
| `sellFeePct` | Fee jual dalam persen, termasuk pajak penjualan (default `0.25`). Hanya untuk **estimasi** hasil bersih jika dijual. Sesuaikan dengan tarif sekuritas Anda. |
| `manualStaleDays` | Setelah berapa hari nilai aset `manual` dianggap usang dan diberi peringatan (default `7`). |
| `holdings[].ticker` | Kode saham BEI, mis. `BBCA`. |
| `holdings[].lots` | Jumlah lot (1 lot = 100 lembar). |
| `holdings[].avgPrice` | Harga rata-rata beli **per lembar**. Fee beli tidak dihitung terpisah; masukkan ke `avgPrice` jika ingin modal akurat. Kalau membeli beberapa kali, hitung rata-ratanya (lihat di bawah). |
| `holdings[].buyDate` | Tanggal beli `YYYY-MM-DD` (disarankan). Dipakai untuk mendeteksi stock split setelah Anda membeli. |
| `holdings[].note` | Catatan bebas (opsional). |
| `manual[]` | Aset yang tidak diperdagangkan di bursa, mis. reksa dana. `invested` = total modal, `currentValue` = nilai terkini dari aplikasi, `updatedAt` = tanggal Anda terakhir memperbarui `currentValue`. |

**Kalau saham Anda melakukan stock split**, misalnya 1 lembar menjadi 5 (5:1), jumlah lot dan `avgPrice` di file portofolio **tidak berubah otomatis**. Sesuaikan manual: `lots × 5` dan `avgPrice ÷ 5`. Server akan memberi peringatan jika mendeteksi split setelah `buyDate`.

**Menghitung `avgPrice` jika membeli beberapa kali:**

```
avgPrice = total uang yang dikeluarkan / total lembar
```

Contoh: beli 1 lot BBCA di Rp4.820 lalu 1 lot lagi di Rp5.200 → (482.000 + 520.000) / 200 = **Rp5.010** dengan `lots: 2`.

## Referensi tools

### `get_quote`
| Parameter | Tipe | Contoh |
| --- | --- | --- |
| `ticker` | string | `"BBCA"`, `"IHSG"` |

Mengembalikan: `price`, `previousClose` (+ `previousCloseSource`), `change`, `changePct`, `dayHigh`, `dayLow`, `fiftyTwoWeekHigh`, `fiftyTwoWeekLow`, `pricePerLot`, serta info kesegaran data:

| Field | Arti |
| --- | --- |
| `marketState` | `open`, `closed`, atau `unknown` (jam bursa tapi status tidak bisa dipastikan, mis. kemungkinan hari libur). |
| `dataAsOfLocal` | Waktu harga terakhir dalam WIB, mis. `Jum, 16 Okt 2026 16:00 WIB`. |
| `dataAgeMinutes` | Umur data dalam menit. |
| `freshnessNote` | Kalimat penjelasan yang disampaikan Claude ke pengguna, termasuk peringatan jika pasar seharusnya buka tapi harga tidak bergerak lebih dari 30 menit. |

### `get_history`
| Parameter | Tipe | Default | Pilihan |
| --- | --- | --- | --- |
| `ticker` | string | — | `"TLKM"` |
| `range` | string | `"6mo"` | `1d` `5d` `1mo` `3mo` `6mo` `1y` `2y` `5y` `10y` `ytd` `max` |
| `interval` | string | `"1d"` | `1d` `1wk` `1mo` |

Mengembalikan `summary` dan `candles` (maks. 300 terakhir; untuk rentang panjang gunakan `1wk` atau `1mo`). Isi `summary`:

| Field | Arti |
| --- | --- |
| `priceReturnPct` | Perubahan **harga saja**, tanpa dividen. |
| `totalReturnPct` | Perubahan harga **+ dividen**, dari harga yang disesuaikan. `null` jika data penyesuaian tidak tersedia. |
| `dividendsInRange`, `dividendsPerShareInRange` | Dividen per lembar yang dibagikan dalam rentang. |
| `splitsInRange` | Stock split dalam rentang. |
| `high`, `low`, `maxDrawdownPct`, `tradingDays` | Tertinggi, terendah, penurunan terdalam dari puncak (berbasis harga disesuaikan, sehingga split tidak terbaca sebagai anjlok). |
| `notes` | Catatan interpretasi. |

Untuk saham yang rutin membagi dividen (mis. saham bank), `totalReturnPct` lebih mencerminkan hasil riil pemegang saham.

### `compare_stocks`
| Parameter | Tipe | Default |
| --- | --- | --- |
| `tickers` | string[] (2–10) | — |
| `range` | string | `"6mo"` |

Diurutkan berdasarkan `totalReturnPct` jika tersedia untuk semua saham; jika tidak, berdasarkan `priceReturnPct`. Dasar pengurutan tercantum di field `rankedBy`. Ticker yang gagal tetap muncul dengan field `error`.

### `get_portfolio`
Tanpa parameter. Membaca file dari environment variable `IDX_PORTFOLIO_PATH`.

| Bagian | Isi |
| --- | --- |
| `holdings[]` | Per saham: `status` (`priced`/`unpriced`), `lastPrice`, `priceAsOf`, `marketState`, `marketValue`, `unrealizedPnl`, `unrealizedPnlPct`, `estimatedNetIfSold`, `dayChangePct`, `warnings`. |
| `manual[]` | Aset manual + `pnl` dan `stale` (usang atau tidak). |
| `totals` | `cost`, `marketValue`, `unrealizedPnl`, `unrealizedPnlPct`, `estimatedNetIfSold`, `incomplete`, `excludedTickers`, `excludedCost`. |
| `assumptions` | Asumsi perhitungan: fee jual, perlakuan fee beli, ukuran lot. |
| `warnings` | Peringatan yang harus disampaikan ke pengguna. |

Aturan integritas:

- **Saham yang harganya gagal diambil tidak ikut dihitung** dalam `totals` (bukan dianggap impas). Saham tersebut tercantum di `excludedTickers`, dan peringatan "Total TIDAK LENGKAP" muncul di urutan pertama `warnings`.
- **Stock split** setelah `buyDate` dideteksi dan diberi peringatan per saham.
- **Aset manual** yang `updatedAt`-nya lebih lama dari `manualStaleDays`, atau tidak punya `updatedAt`, diberi peringatan.
- `estimatedNetIfSold` = nilai pasar − `sellFeePct`. Ini **perkiraan**; hasil jual sebenarnya tergantung harga eksekusi dan tarif sekuritas.

## Troubleshooting

| Masalah | Solusi |
| --- | --- |
| `idx-stock` tidak muncul di Claude Desktop | Pastikan JSON config valid (tanpa koma berlebih), path ke `dist/index.js` benar dan sudah `npm run build`, lalu quit Claude Desktop sepenuhnya dan buka lagi. Log ada di menu Developer → Open Logs. |
| `node: command not found` | Node.js belum terpasang atau tidak ada di PATH. Ganti `"command": "node"` dengan path lengkap, mis. `/usr/local/bin/node` (cek dengan `which node`). |
| `IDX_PORTFOLIO_PATH belum di-set` | Tambahkan bagian `env` di config (langkah 4), lalu restart Claude Desktop. |
| `File portofolio tidak ditemukan` | Path di `IDX_PORTFOLIO_PATH` salah. Gunakan path lengkap (absolut), bukan `./portfolio.json`. |
| `Format portofolio tidak valid` | Periksa nama field dan tipe datanya (angka tanpa tanda kutip, tanpa titik ribuan: `4820`, bukan `"4.820"`). |
| `Saham "XXXX" tidak ditemukan` | Kode saham salah atau sudah delisting. Cek kode di <https://www.idx.co.id>. |
| `Gagal mengambil data (429 ...)` | Terlalu banyak request ke Yahoo. Tunggu beberapa menit. |
| Harga berbeda dengan aplikasi sekuritas | Data Yahoo bisa tertunda beberapa menit selama jam bursa. Cek `dataAsOfLocal` dan `freshnessNote`. Untuk transaksi, selalu acu harga di aplikasi sekuritas. |
| Untung/rugi sebuah saham terlihat sangat besar/aneh | Kemungkinan saham tersebut melakukan stock split. Cek `warnings`, lalu sesuaikan `lots` dan `avgPrice`. |
| Peringatan `buyDate ... tidak diisi` | Tambahkan `buyDate` di holding tersebut agar pengecekan split akurat. |

## Sumber data & batasan

- Harga diambil dari endpoint chart **Yahoo Finance** (simbol berakhiran `.JK`, IHSG = `^JKSE`). Endpoint ini **tidak resmi**: bisa berubah atau dibatasi tanpa pemberitahuan, dan harga bisa tertunda dari bursa. Pastikan penggunaan sesuai ketentuan layanan Yahoo.
- Respons di-cache 60 detik untuk mengurangi jumlah request.
- Reksa dana tidak tersedia di sumber data ini, jadi nilainya diisi manual di file portofolio.
- Kode sumber data terisolasi di `src/yahoo.ts`, sehingga mudah diganti dengan penyedia data berlisensi bila diperlukan.

## Pengembangan

```
src/
  index.ts      # entry point (stdio transport)
  server.ts     # definisi tools MCP
  yahoo.ts      # klien & parser data harga, dividen, split, status pasar
  summary.ts    # ringkasan performa (price/total return, drawdown)
  portfolio.ts  # skema & perhitungan portofolio
test/           # unit + integration test (node:test, fetch tiruan)
```

| Perintah | Fungsi |
| --- | --- |
| `npm run build` | Compile TypeScript ke `dist/` |
| `npm test` | Jalankan test (offline, memakai data tiruan) |
| `npm run inspect` | Coba tools secara interaktif di MCP Inspector |
| `npm start` | Jalankan server via stdio |

## Kontribusi

Laporan bug, usulan fitur, dan PR sangat diterima. Baca [CONTRIBUTING.md](CONTRIBUTING.md) terlebih dahulu.
Saat melapor bug, gunakan template issue dan sertakan output JSON dari MCP Inspector.

## Lisensi

[MIT](LICENSE) © 2026 Zalfrie
