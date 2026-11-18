# ZAIN AI Trading Terminal

Frontend statis untuk GitHub Pages. Terhubung ke Supabase proyek ZAIN.NET dan harga publik Binance.

## Fitur versi awal
- Login melalui Supabase Auth (akun harus sudah ada dan memiliki izin database).
- Market watch BTCUSDT, ETHUSDT, SOLUSDT dari Binance public REST API.
- Membaca view `zain_trade_dashboard_history`.
- Menampilkan sinyal terbaru, status, ringkasan, dan riwayat.
- Refresh otomatis setiap 30 detik.

## Keamanan
- `config.js` hanya berisi Supabase URL dan publishable/anon key. Key ini memang untuk frontend.
- JANGAN memasukkan `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, atau secret Cron ke frontend.
- Login saja tidak otomatis memberi hak baca. Pastikan RLS/policy pada tabel sumber dan view mengizinkan user yang tepat.
- Jika view kosong atau permission denied, jangan menonaktifkan RLS. Buat policy terbatas untuk role/akun admin yang benar.

## Deploy GitHub Pages
1. Buat repository baru bernama `ZAIN-AI-TRADING-TERMINAL`.
2. Upload semua file dari ZIP ini ke root repository (bukan folder pembungkus).
3. Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save.
4. Tunggu deployment selesai. URL biasanya `https://USERNAME.github.io/ZAIN-AI-TRADING-TERMINAL/`.

## Catatan
Aplikasi ini hanya dashboard pemantauan. Versi ini tidak mengeksekusi order dan tidak menganggap status `PENDING`/`FAILED` sebagai sinyal valid. Analisis AI dan akurasi harus diuji sebelum dipakai untuk keputusan transaksi.
