/**
 * pwa.js - Modul PWA dan Lifecycle Service Worker Toko Dani
 * Mengelola instalasi PWA, status online/offline, prompt install, dan background sync event
 */

let deferredInstallPrompt = null;
let isAppOnline = navigator.onLine;

/**
 * Daftarkan Service Worker
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service Worker tidak didukung pada browser ini.');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('[PWA] Service Worker berhasil didaftarkan dengan scope:', registration.scope);

    // Dengar pesan dari Service Worker (misal: saat background sync terpicu)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'TRIGGER_BACKGROUND_SYNC') {
        console.log('[PWA] Menerima sinyal Background Sync dari Service Worker');
        window.dispatchEvent(new CustomEvent('app:trigger-sync'));
      }
    });

    return registration;
  } catch (err) {
    console.warn('[PWA] Gagal mendaftarkan Service Worker:', err);
    return null;
  }
}

/**
 * Inisialisasi event listener koneksi online/offline & tombol install
 */
export function initPWAEvents({ onConnectionChange, onInstallableChange } = {}) {
  // 1. Tangani event online & offline
  window.addEventListener('online', () => {
    isAppOnline = true;
    console.log('[PWA] Koneksi kembali ONLINE');
    if (typeof onConnectionChange === 'function') onConnectionChange(true);
    window.dispatchEvent(new CustomEvent('app:connection-change', { detail: { online: true } }));
    window.dispatchEvent(new CustomEvent('app:trigger-sync'));
  });

  window.addEventListener('offline', () => {
    isAppOnline = false;
    console.log('[PWA] Perangkat masuk ke mode OFFLINE');
    if (typeof onConnectionChange === 'function') onConnectionChange(false);
    window.dispatchEvent(new CustomEvent('app:connection-change', { detail: { online: false } }));
  });

  // 2. Tangani prompt instalasi browser (Android / Chrome Desktop / Edge)
  window.addEventListener('beforeinstallprompt', (e) => {
    // Cegah mini-infobar default browser agar bisa menggunakan tombol sendiri
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('[PWA] Aplikasi siap di-install (beforeinstallprompt terpicu)');
    if (typeof onInstallableChange === 'function') onInstallableChange(true);
    window.dispatchEvent(new CustomEvent('app:can-install', { detail: { canInstall: true } }));
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    console.log('[PWA] Aplikasi Toko Dani telah berhasil di-install!');
    if (typeof onInstallableChange === 'function') onInstallableChange(false);
    window.dispatchEvent(new CustomEvent('app:installed'));
  });
}

/**
 * Tampilkan prompt install PWA ke pengguna
 */
export async function promptInstallApp() {
  if (!deferredInstallPrompt) {
    alert(
      'Aplikasi sudah terpasang atau browser Anda belum memunculkan banner instalasi.\n\n' +
      'Tips Android: Ketuk menu browser (titik 3 di kanan atas) lalu pilih "Tambahkan ke Layar Utama" / "Instal Aplikasi".\n' +
      'Tips Komputer: Klik ikon komputer / tanda (+) di bilah alamat browser untuk meng-install.'
    );
    return false;
  }

  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  console.log(`[PWA] Keputusan pengguna install: ${outcome}`);
  deferredInstallPrompt = null;
  return outcome === 'accepted';
}

/**
 * Cek apakah aplikasi sedang berjalan dalam mode Standalone PWA (terinstal)
 */
export function isRunningStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

/**
 * Status koneksi saat ini
 */
export function getOnlineStatus() {
  return navigator.onLine;
}
