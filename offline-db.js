/**
 * offline-db.js - Modul IndexedDB Toko Dani
 * Mengelola penyimpanan transaksi offline, status antrean, dan cache produk lokal.
 */

const DB_NAME = 'TokoDaniOfflineDB';
const DB_VERSION = 1;

let dbPromise = null;

/**
 * Buka atau inisialisasi koneksi IndexedDB
 */
export function openOfflineDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      console.warn('[OfflineDB] IndexedDB tidak didukung pada browser ini.');
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Store Transaksi Offline (Menunggu dikirim / Gagal dikirim)
      if (!db.objectStoreNames.contains('offline_transactions')) {
        const transStore = db.createObjectStore('offline_transactions', { keyPath: 'id' });
        transStore.createIndex('syncStatus', 'syncStatus', { unique: false });
        transStore.createIndex('createdAt', 'createdAt', { unique: false });
        transStore.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
      }

      // 2. Store Cache Produk Lokal untuk operasional kasir offline
      if (!db.objectStoreNames.contains('cached_products')) {
        db.createObjectStore('cached_products', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('[OfflineDB] Gagal membuka IndexedDB:', request.error);
      reject(request.error);
    };
  });

  return dbPromise;
}

/**
 * Simpan transaksi baru yang dibuat saat offline ke IndexedDB
 * Status awal: "Menunggu dikirim"
 */
export async function saveOfflineTransaction(transaction) {
  const db = await openOfflineDB();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('offline_transactions', 'readwrite');
      const store = tx.objectStore('offline_transactions');

      const offlineRecord = {
        ...transaction,
        id: transaction.id || `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        idempotencyKey: transaction.idempotencyKey || `idem-${transaction.number || Date.now()}`,
        syncStatus: 'Menunggu dikirim', // 'Menunggu dikirim' | 'Gagal dikirim' | 'Terkirim'
        retryCount: 0,
        lastError: null,
        savedOfflineAt: new Date().toISOString(),
      };

      const request = store.put(offlineRecord);

      request.onsuccess = () => resolve(offlineRecord);
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Ambil semua transaksi offline dari IndexedDB
 */
export async function getAllOfflineTransactions() {
  const db = await openOfflineDB();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('offline_transactions', 'readonly');
      const store = tx.objectStore('offline_transactions');
      const request = store.getAll();

      request.onsuccess = () => {
        const list = request.result || [];
        // Urutkan dari yang terbaru
        list.sort((a, b) => new Date(b.createdAt || b.savedOfflineAt) - new Date(a.createdAt || a.savedOfflineAt));
        resolve(list);
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Ambil daftar transaksi yang masih berstatus antrean ("Menunggu dikirim" atau "Gagal dikirim")
 */
export async function getPendingOfflineTransactions() {
  const all = await getAllOfflineTransactions();
  return all.filter((t) => t.syncStatus === 'Menunggu dikirim' || t.syncStatus === 'Gagal dikirim');
}

/**
 * Hitung jumlah transaksi yang belum terkirim ke server
 */
export async function getPendingCount() {
  try {
    const pending = await getPendingOfflineTransactions();
    return pending.length;
  } catch (_) {
    return 0;
  }
}

/**
 * Update status transaksi di IndexedDB setelah proses sinkronisasi
 */
export async function updateTransactionSyncStatus(id, syncStatus, errorMsg = null) {
  const db = await openOfflineDB();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('offline_transactions', 'readwrite');
      const store = tx.objectStore('offline_transactions');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) {
          resolve(null);
          return;
        }

        record.syncStatus = syncStatus;
        if (errorMsg) {
          record.lastError = errorMsg;
          record.retryCount = (record.retryCount || 0) + 1;
        } else {
          record.syncedAt = new Date().toISOString();
        }

        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(record);
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Hapus transaksi offline dari IndexedDB (opsional setelah terkirim atau saat reset data)
 */
export async function deleteOfflineTransaction(id) {
  const db = await openOfflineDB();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('offline_transactions', 'readwrite');
      const store = tx.objectStore('offline_transactions');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Simpan cadangan produk lokal ke IndexedDB agar kasir bisa jualan saat offline
 */
export async function cacheProductsLocally(products) {
  const db = await openOfflineDB();
  if (!db || !Array.isArray(products) || !products.length) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('cached_products', 'readwrite');
      const store = tx.objectStore('cached_products');
      store.clear();
      for (const p of products) {
        store.put(p);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Ambil produk dari cache lokal jika tidak ada koneksi Firebase
 */
export async function getCachedProductsLocally() {
  const db = await openOfflineDB();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('cached_products', 'readonly');
      const store = tx.objectStore('cached_products');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}
