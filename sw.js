// Service Worker Toko Dani PWA
// Versi cache & nama cache
const CACHE_NAME = 'toko-dani-v1';
const OFFLINE_URL = './index.html';

// Daftar aset utama aplikasi yang di-precache agar dapat berjalan 100% offline
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400..700,0..1,-50..200',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  'https://unpkg.com/@zxing/browser@latest'
];

// 1. Install Event: Cache aset statis aplikasi
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache aset lokal penting dengan jaminan berhasil
      for (const url of STATIC_ASSETS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[SW] Gagal meng-cache aset:', url, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Bersihkan cache versi lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Menghapus cache usang:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Strategi Network-First dengan Fallback ke Cache
// Memastikan data terbaru selalu diambil saat online, namun tetap bekerja mulus saat offline
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Abaikan request non-GET (POST/PUT/etc) dan request ke Firebase Firestore / Auth
  if (req.method !== 'GET') return;
  if (url.origin.includes('firestore.googleapis.com') ||
      url.origin.includes('identitytoolkit.googleapis.com') ||
      url.origin.includes('firebaseinstallations.googleapis.com')) {
    return;
  }

  // Strategi Cache First untuk Font & CDN eksternal agar loading instan
  if (url.origin.includes('fonts.googleapis.com') ||
      url.origin.includes('fonts.gstatic.com') ||
      url.origin.includes('cdn.tailwindcss.com') ||
      url.origin.includes('cdn.jsdelivr.net') ||
      url.origin.includes('unpkg.com')) {
    event.respondWith(
      caches.match(req).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => caches.match(req));
      })
    );
    return;
  }

  // Strategi Stale-While-Revalidate untuk halaman utama & file statis lokal
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // Jika offline dan navigasi halaman HTML, berikan index.html dari cache
        if (req.mode === 'navigate') {
          return caches.match(OFFLINE_URL);
        }
        throw err;
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// 4. Background Sync: Sinkronisasi Transaksi Tertunda saat Koneksi Kembali
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-transactions') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'TRIGGER_BACKGROUND_SYNC',
            source: 'service-worker-sync'
          });
        });
      })
    );
  }
});
