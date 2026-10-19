# idx-stock-mcp

MCP server agar Claude bisa membaca data saham **Bursa Efek Indonesia (IDX/BEI)** dan menghitung nilai portofolio pribadi Anda.

> ⚠️ Server ini **hanya membaca data**. Tidak ada fitur beli/jual, dan tidak terhubung ke akun sekuritas mana pun. Data untuk informasi, bukan rekomendasi investasi.

## Tools

| Tool | Fungsi |
| --- | --- |
| `get_quote` | Harga terakhir, perubahan harian, rentang 52 minggu, harga per lot (100 lembar). Terima `BBCA`, `bbri.jk`, atau `IHSG`. |
| `get_history` | Riwayat OHLC + volume untuk rentang `1mo`–`max`, plus ringkasan: return %, tertinggi, terendah, max drawdown. |
| `compare_stocks` | Bandingkan 2–10 saham/indeks pada rentang yang sama, diurutkan berdasarkan return. |
| `get_portfolio` | Baca file portofolio lokal, hitung nilai pasar, untung/rugi belum terealisasi, dan estimasi hasil bersih setelah fee jual. |

Contoh pertanyaan ke Claude setelah terpasang:

- "Berapa harga BBCA sekarang dan berapa 1 lotnya?"
- "Bandingkan BBCA, BBRI, BMRI, dan IHSG selama 1 tahun terakhir."
- "Berapa nilai portofolio saya hari ini?"

## Instalasi

Butuh Node.js 20+.

```bash
git clone git@github.com:Zalfrie/idx-stock-mcp.git
cd idx-stock-mcp
npm install
npm run build
npm test
```

### Pasang di Claude Desktop

Edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "idx-stock": {
      "command": "node",
      "args": ["/path/lengkap/ke/idx-stock-mcp/dist/index.js"],
      "env": {
        "IDX_PORTFOLIO_PATH": "/path/lengkap/ke/portfolio.json"
      }
    }
  }
}
```

Restart Claude Desktop, tool `idx-stock` akan muncul.

### Pasang di Claude Code

```bash
claude mcp add idx-stock -e IDX_PORTFOLIO_PATH=/path/ke/portfolio.json -- node /path/ke/idx-stock-mcp/dist/index.js
```

### Debug dengan MCP Inspector

```bash
npm run inspect
```

## File portofolio

Salin `portfolio.example.json` menjadi `portfolio.json` (sudah di-`.gitignore`), lalu isi:

```json
{
  "sellFeePct": 0.25,
  "holdings": [
    { "ticker": "BBCA", "lots": 1, "avgPrice": 4820, "note": "beli pertama" }
  ],
  "manual": [
    { "name": "Reksa dana indeks IDX30 (Bibit)", "invested": 500000, "currentValue": 500000, "updatedAt": "2026-10-19" }
  ]
}
```

- `holdings` — saham BEI. `avgPrice` = harga rata-rata beli per lembar. Harga terkini diambil otomatis.
- `manual` — aset yang tidak diperdagangkan di bursa (mis. reksa dana di Bibit). Nilai terkini diisi manual dari aplikasi.
- `sellFeePct` — fee jual broker dalam persen, untuk estimasi hasil bersih jika dijual. Sesuaikan dengan tarif sekuritas Anda.

## Sumber data & batasan

- Harga diambil dari endpoint chart **Yahoo Finance** (simbol berakhiran `.JK`, IHSG = `^JKSE`). Endpoint ini **tidak resmi**: bisa berubah atau dibatasi tanpa pemberitahuan, dan harga bisa tertunda dari bursa. Pastikan penggunaan sesuai ketentuan layanan Yahoo.
- Respons di-cache 60 detik untuk mengurangi jumlah request.
- Kode sumber data terisolasi di `src/yahoo.ts`, jadi mudah diganti dengan penyedia data berlisensi bila diperlukan.

## Struktur

```
src/
  index.ts      # entry point stdio
  server.ts     # definisi tools MCP
  yahoo.ts      # klien & parser data harga
  portfolio.ts  # skema & perhitungan portofolio
test/           # unit + integration test (node:test, fetch tiruan)
```
