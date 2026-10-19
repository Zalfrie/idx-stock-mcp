# idx-stock-mcp

MCP server agar Claude bisa membaca harga saham **Bursa Efek Indonesia (IDX/BEI)**, membandingkan performa saham, dan menghitung nilai portofolio pribadi Anda langsung dari percakapan.

> ⚠️ Server ini **hanya membaca data**. Tidak ada fitur beli/jual dan tidak terhubung ke akun sekuritas mana pun (Bibit, Stockbit, Ajaib, dll). Data untuk informasi, bukan rekomendasi investasi.

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

## Fitur

| Tool | Fungsi |
| --- | --- |
| `get_quote` | Harga terakhir, perubahan harian, rentang 52 minggu, dan harga per lot (100 lembar). |
| `get_history` | Riwayat harga (OHLC + volume) dengan ringkasan return %, tertinggi, terendah, dan max drawdown. |
| `compare_stocks` | Bandingkan 2–10 saham/indeks pada rentang waktu yang sama, diurutkan berdasarkan return. |
| `get_portfolio` | Hitung nilai portofolio Anda: untung/rugi per saham, total, dan estimasi hasil bersih setelah fee jual. |

Kode saham bisa ditulis `BBCA`, `bbca`, atau `BBCA.JK`. Untuk indeks gunakan `IHSG`.

## Cara pakai (langkah demi langkah)

### 1. Persiapan

- **Node.js 20 atau lebih baru.** Cek dengan `node -v`. Download di <https://nodejs.org>.
- **Git** (untuk clone repo).
- **Claude Desktop** atau **Claude Code** di komputer Anda.

### 2. Download & build

```bash
git clone git@github.com:Zalfrie/idx-stock-mcp.git
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

### 5. Mulai bertanya

Cukup bertanya dengan bahasa biasa, dan Claude akan memanggil tool yang sesuai.

| Anda bertanya | Tool yang dipakai |
| --- | --- |
| "Berapa harga BBCA sekarang? 1 lotnya berapa?" | `get_quote` |
| "Bagaimana kondisi IHSG hari ini?" | `get_quote` |
| "Tunjukkan pergerakan TLKM 1 tahun terakhir, turunnya paling dalam berapa persen?" | `get_history` |
| "Bandingkan BBCA, BBRI, BMRI, dan IHSG selama 6 bulan." | `compare_stocks` |
| "Bank mana yang paling tahan banting tahun ini?" | `compare_stocks` |
| "Berapa nilai portofolio saya hari ini? Untung atau rugi?" | `get_portfolio` |
| "Kalau semua saham saya jual sekarang, dapat bersih berapa?" | `get_portfolio` |

Tips:

- Sebutkan rentang waktu kalau perlu: `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `ytd`, `max`.
- Setelah membeli atau menjual saham, **update `portfolio.json`**. Server membaca file ini setiap kali dipanggil, jadi tidak perlu restart.
- Untuk reksa dana Bibit, update nilai `currentValue` di bagian `manual` sesekali, misalnya seminggu sekali, sesuai angka di aplikasi.

## Format file portofolio

```json
{
  "sellFeePct": 0.25,
  "holdings": [
    { "ticker": "BBCA", "lots": 1, "avgPrice": 4820, "note": "beli pertama" },
    { "ticker": "BBRI", "lots": 2, "avgPrice": 3500 }
  ],
  "manual": [
    { "name": "Reksa dana indeks IDX30 (Bibit)", "invested": 500000, "currentValue": 512000, "updatedAt": "2026-10-19" }
  ]
}
```

| Field | Keterangan |
| --- | --- |
| `sellFeePct` | Fee jual broker dalam persen (default `0.25`). Dipakai untuk estimasi hasil bersih jika dijual. Sesuaikan dengan tarif sekuritas Anda. |
| `holdings[].ticker` | Kode saham BEI, mis. `BBCA`. |
| `holdings[].lots` | Jumlah lot (1 lot = 100 lembar). |
| `holdings[].avgPrice` | Harga rata-rata beli **per lembar**. Kalau membeli beberapa kali di harga berbeda, hitung rata-ratanya (lihat di bawah). |
| `holdings[].note` | Catatan bebas (opsional). |
| `manual[]` | Aset yang tidak diperdagangkan di bursa, mis. reksa dana. `invested` = total modal, `currentValue` = nilai terkini dari aplikasi. |

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

Mengembalikan: `price`, `previousClose`, `change`, `changePct`, `dayHigh`, `dayLow`, `fiftyTwoWeekHigh`, `fiftyTwoWeekLow`, `pricePerLot`, `marketTime`.

### `get_history`
| Parameter | Tipe | Default | Pilihan |
| --- | --- | --- | --- |
| `ticker` | string | — | `"TLKM"` |
| `range` | string | `"6mo"` | `1d` `5d` `1mo` `3mo` `6mo` `1y` `2y` `5y` `10y` `ytd` `max` |
| `interval` | string | `"1d"` | `1d` `1wk` `1mo` |

Mengembalikan: `summary` (`returnPct`, `high`, `low`, `maxDrawdownPct`, `tradingDays`) dan `candles` (maks. 300 terakhir). Untuk rentang panjang gunakan `1wk` atau `1mo`.

### `compare_stocks`
| Parameter | Tipe | Default |
| --- | --- | --- |
| `tickers` | string[] (2–10) | — |
| `range` | string | `"6mo"` |

Hasil diurutkan dari return tertinggi. Ticker yang gagal tetap muncul dengan field `error`.

### `get_portfolio`
Tanpa parameter. Membaca file dari environment variable `IDX_PORTFOLIO_PATH`. Mengembalikan rincian per saham (`marketValue`, `unrealizedPnl`, `unrealizedPnlPct`, `estNetIfSold`, `dayChangePct`) dan `totals`. Jika harga sebuah saham gagal diambil, `totals.incomplete` bernilai `true`.

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
| Harga berbeda dengan aplikasi sekuritas | Data Yahoo bisa tertunda beberapa menit selama jam bursa. Untuk transaksi, selalu acu harga di aplikasi sekuritas. |

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
  yahoo.ts      # klien & parser data harga
  portfolio.ts  # skema & perhitungan portofolio
test/           # unit + integration test (node:test, fetch tiruan)
```

| Perintah | Fungsi |
| --- | --- |
| `npm run build` | Compile TypeScript ke `dist/` |
| `npm test` | Jalankan test (offline, memakai data tiruan) |
| `npm run inspect` | Coba tools secara interaktif di MCP Inspector |
| `npm start` | Jalankan server via stdio |
