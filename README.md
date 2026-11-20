# Toko Dani · PWA Kasir & Manajemen Toko (Offline & Cloud Sync)

Aplikasi Web Progresif (PWA) untuk kasir POS dan manajemen persediaan warung Toko Dani dengan kemampuan **100% Offline-Ready**, penyimpanan lokal aman dengan **IndexedDB**, serta **Sinkronisasi Otomatis** ke Cloud Firestore saat online.

---

## 🚀 Fitur Utama PWA

1. **Instalasi PWA (Desktop & Android)**:
   - Dilengkapi `manifest.webmanifest`, ikon aplikasi (192px, 512px, SVG), warna tema (`#00652c`), dan splash screen.
   - Mode display `standalone` (tampil seperti aplikasi native tanpa address bar browser).
   - Tombol instalasi otomatis di header browser yang kompatibel.

2. **Dukungan Penuh Offline (Service Worker & Cache Storage)**:
   - Service Worker (`sw.js`) meng-cache HTML, CSS, JavaScript, font Google, ikon, serta pustaka pendukung.
   - Aplikasi tetap dapat dibuka, dimuat, dan digunakan untuk transaksi penjualan meskipun tidak ada sinyal internet.
   - Indikator status jaringan real-time: **Online** (hijau) atau **Offline** (kuning/oranye).

3. **Penyimpanan Transaksi Offline (IndexedDB)**:
   - Transaksi saat offline disimpan ke IndexedDB pada store `offline_transactions` dengan status `"Menunggu dikirim"`.
   - Menggunakan ID unik, waktu pembuatan, detail item belanja, total harga, dan data pelanggan.
   - Data transaksi lokal persisten dan tidak akan hilang meskipun browser ditutup atau perangkat dimatikan.
   - Counter badge di header menunjukkan jumlah transaksi yang masih mengantre untuk dikirim.

4. **Sinkronisasi Otomatis & Proteksi Idempotency**:
   - Begitu internet kembali online atau aplikasi dibuka kembali, sistem otomatis mengirim transaksi yang tertunda ke server Firebase.
   - Didukung **Background Sync API** pada browser yang mendukung.
   - Tersedia tombol manual **"Sinkronkan Sekarang"** di modal antrean offline.
   - Proteksi **Idempotency Key** memastikan transaksi tidak pernah tercatat ganda meskipun proses sinkronisasi dicoba berulang kali.
   - Setelah sukses terkirim, status berubah menjadi `"Terkirim"`. Jika gagal, status menjadi `"Gagal dikirim"` dan tetap tersimpan aman untuk dicoba kembali.

5. **Keamanan & Validasi Data**:
   - Validasi ketat format data transaksi sebelum disimpan maupun dikirim.
   - Tidak menyimpan informasi rahasia atau kredensial sensitif di perangkat.
   - Transaksi tidak dianggap berhasil terkirim sebelum server memberikan respons sukses.

---

## 📁 Struktur Kode Modul

- `manifest.webmanifest` : Konfigurasi PWA (nama, ikon, warna tema, display mode, shortcuts).
- `sw.js` : Service Worker (caching aset statis & penanganan Background Sync).
- `offline-db.js` : Modul IndexedDB untuk transaksi offline dan cache produk lokal.
- `sync.js` : Modul logika sinkronisasi transaksi tertunda ke Firebase Firestore dengan idempotency.
- `pwa.js` : Modul penanganan event PWA (online/offline listener, beforeinstallprompt, install helper).
- `app.js` : Logika utama aplikasi kasir, stok, keuangan, dan UI antrean offline.
- `icons/` : Aset ikon PNG (192px & 512px) dan vektor SVG.

---

## 🛠️ Cara Menjalankan Aplikasi

Karena PWA membutuhkan origin HTTP/HTTPS lokal untuk mengaktifkan Service Worker dan ES Modules, jalankan aplikasi menggunakan web server lokal:

### Menggunakan Python:
```bash
# Jalankan di dalam folder toko-dani
python -m http.server 8000
```
Buka browser di: `http://localhost:8000`

### Menggunakan Node.js (npx serve / http-server):
```bash
npx serve .
```

---

## 📲 Cara Meng-install PWA

### Di Android (Chrome / Edge):
1. Buka URL aplikasi di Google Chrome / Microsoft Edge.
2. Ketuk tombol **Install** di header atas, atau ketuk menu titik tiga (⋮) di kanan atas browser.
3. Pilih **"Tambahkan ke Layar Utama"** atau **"Instal Aplikasi"**.
4. Ikon Toko Dani akan muncul di layar utama (home screen) dan dapat dibuka mandiri (*standalone*) tanpa bilah alamat browser.

### Di Desktop / Laptop (Windows / Mac / Linux):
1. Buka aplikasi di Chrome atau Edge.
2. Klik tombol **Install** di header navigasi Toko Dani, atau klik ikon komputer/tanda (+) pada bilah alamat URL browser (address bar).
3. Klik **"Install"**. Toko Dani akan terbuka dalam jendela aplikasi tersendiri dan memiliki shortcut di Desktop / Start Menu.

---

## 🧪 Panduan Uji Coba Skenario Offline & Sinkronisasi

Anda dapat menguji skenario offline langsung melalui Google Chrome / Edge DevTools:

1. **Membuka Aplikasi Tanpa Internet**:
   - Buka aplikasi `http://localhost:8000` sekali saat terhubung.
   - Buka DevTools (F12) → Tab **Network** → Ubah dropdown dari *No throttling* menjadi **Offline**.
   - Muat ulang (Refresh) halaman (F5).
   - **Hasil**: Aplikasi tetap terbuka mulus dan cepat berkat Service Worker cache. Indikator header otomatis berubah menjadi kuning **"Offline"**.

2. **Membuat Transaksi Tanpa Internet**:
   - Masih dalam mode **Offline**, pilih barang di kasir dan lakukan pembayaran.
   - **Hasil**: Transaksi sukses diproses secara lokal dengan notifikasi *"Transaksi disimpan OFFLINE (Menunggu dikirim)"*. Badge antrean di header menampilkan angka `1`.

3. **Menutup dan Membuka Kembali Aplikasi**:
   - Tutup tab browser atau tutup jendela aplikasi sepenuhnya.
   - Buka kembali `http://localhost:8000` (masih dalam mode offline).
   - Klik badge status di header untuk membuka modal antrean.
   - **Hasil**: Transaksi yang tadi dibuat tetap ada di IndexedDB dengan status *"Menunggu dikirim"*, tidak hilang sedikit pun.

4. **Mengaktifkan Internet Kembali & Sinkronisasi Otomatis**:
   - Di DevTools tab Network, kembalikan ke **Online** (*No throttling*).
   - **Hasil**: Indikator header langsung berubah hijau **"Online"**, toast *"Koneksi internet kembali ONLINE!"* muncul, dan sistem otomatis menyinkronkan transaksi ke Firebase.
   - Status transaksi berubah menjadi *"Terkirim"*, dan stok produk di cloud otomatis terpotong sesuai pembelian.

5. **Memastikan Transaksi Otomatis Terkirim Satu Kali (Idempotency)**:
   - Jika tombol *"Sinkronkan Sekarang"* ditekan berulang kali, transaksi tidak akan pernah tercatat ganda di server karena dilindungi `idempotencyKey` dan pemeriksaan nomor nota unik.

6. **Memastikan Transaksi Tetap Tersimpan Jika Pengiriman Gagal**:
   - Jika koneksi terputus di tengah proses pengiriman, transaksi tidak akan dihapus melainkan diberi status *"Gagal dikirim"* disertai pesan error, dan dapat dicoba lagi secara aman kapan saja.
