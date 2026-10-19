# Berkontribusi ke idx-stock-mcp

Terima kasih sudah tertarik berkontribusi!

## Melaporkan masalah

- **Bug / data salah:** buka issue dengan template **Laporan bug**. Sertakan input, output (JSON), dan waktu kejadian dalam WIB.
- **Ide fitur:** gunakan template **Usulan fitur**.
- **Celah keamanan:** jangan dibuka sebagai issue publik. Ikuti [SECURITY.md](SECURITY.md).

Jangan pernah menempel isi `portfolio.json` lengkap, token, atau data pribadi di issue.

## Alur kerja maintainer

Repo ini memakai [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions). Maintainer bisa menulis `@claude` di issue atau PR untuk meminta Claude menganalisis, memperbaiki, atau me-review. Hanya pengguna dengan akses tulis yang bisa memicu Claude. Semua perubahan dari Claude tetap di-review manusia sebelum merge.

## Mengirim PR

1. Fork repo, lalu buat branch dari `main`.
2. Setup lokal:
   ```bash
   git clone https://github.com/<akun-anda>/idx-stock-mcp.git
   cd idx-stock-mcp
   npm ci
   npm test
   ```
3. Buat perubahan **beserta test**. Test memakai data tiruan di `test/fixtures.ts` dan tidak boleh memanggil internet.
4. Pastikan `npm test` lulus. CI menjalankan build dan test di Node 20 dan 22.
5. Isi checklist di template PR.

## Prinsip proyek

Baca [CLAUDE.md](CLAUDE.md). Aturan yang sama berlaku untuk kontributor manusia:

- **Read-only.** Tidak ada eksekusi order atau koneksi ke akun sekuritas.
- **Integritas data di atas kelengkapan.** Lebih baik `null` + peringatan daripada angka tebakan.
- Teks untuk pengguna dalam Bahasa Indonesia; kode dalam bahasa Inggris.
- Perubahan sumber data atau dependency baru didiskusikan dulu di issue.

## Lisensi

Dengan mengirim kontribusi, Anda setuju kontribusi tersebut dilisensikan di bawah [MIT](LICENSE).
