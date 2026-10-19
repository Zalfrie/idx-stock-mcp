# Kebijakan Keamanan

## Versi yang didukung

Hanya rilis terbaru di branch `main` yang menerima perbaikan keamanan.

## Melaporkan celah keamanan

**Jangan** membuka issue publik untuk celah keamanan.

1. Jika tombol **Report a vulnerability** tersedia di tab [Security](../../security/advisories/new) repo ini, gunakan itu
   (Private vulnerability reporting GitHub).
2. Jika tombol itu belum tersedia, buka issue biasa yang **hanya** berisi permintaan kontak privat
   (tanpa detail celahnya), dan maintainer akan menghubungi Anda.

Sertakan versi `idx-stock-mcp`, langkah reproduksi, dan dampaknya. Laporan akan ditanggapi dalam 7 hari kerja.

## Cakupan

Server ini **hanya membaca** data: tidak ada eksekusi order, kredensial, atau penulisan file pengguna.
Dua batas keamanan utama yang relevan untuk laporan:

- Validasi kode saham (`normalizeTicker`) sebelum membentuk URL ke sumber data.
- File portofolio hanya dibaca dari path di environment variable `IDX_PORTFOLIO_PATH`.

Jangan menyertakan isi `portfolio.json`, token, atau data pribadi dalam laporan.
