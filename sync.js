/**
 * sync.js - Modul Sinkronisasi Transaksi Offline Toko Dani
 * Mengelola pengiriman transaksi tertunda ke Firebase Firestore dengan jaminan idempotency
 */

import {
  getPendingOfflineTransactions,
  updateTransactionSyncStatus,
  getPendingCount,
} from './offline-db.js';

let isSyncing = false;

/**
 * Validasi ketat integritas data transaksi sebelum disimpan maupun dikirim
 */
export function validateTransactionData(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Data transaksi kosong atau tidak valid.' };
  }

  if (!data.number || typeof data.number !== 'string') {
    return { valid: false, error: 'Nomor nota transaksi tidak valid.' };
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    return { valid: false, error: 'Daftar barang belanja masih kosong.' };
  }

  for (const item of data.items) {
    if (!item.name || typeof item.name !== 'string') {
      return { valid: false, error: 'Nama barang dalam transaksi tidak valid.' };
    }
    const qty = Number(item.qty);
    const price = Number(item.price);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { valid: false, error: `Jumlah barang ${item.name} tidak valid.` };
    }
    if (!Number.isFinite(price) || price < 0) {
      return { valid: false, error: `Harga barang ${item.name} tidak valid.` };
    }
  }

  const total = Number(data.total);
  if (!Number.isFinite(total) || total < 0) {
    return { valid: false, error: 'Total belanja tidak valid.' };
  }

  const received = Number(data.received);
  if (Number.isFinite(received) && received < total && data.paymentMethod === 'Tunai') {
    return { valid: false, error: 'Uang yang diterima kurang dari total belanja.' };
  }

  return { valid: true };
}

/**
 * Mendaftarkan Background Sync Service Worker jika didukung browser
 */
export async function requestBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('sync-offline-transactions');
      console.log('[Sync] Background sync terdaftar: sync-offline-transactions');
    } catch (err) {
      console.warn('[Sync] Background sync tidak dapat didaftarkan:', err);
    }
  }
}

/**
 * Sinkronkan semua transaksi tertunda ke Firebase Firestore
 * @param {Object} options - { db, runTransaction, doc, collection, setDoc, getDocs, query, where, serverTimestamp, onProgress }
 */
export async function syncPendingTransactions(options = {}) {
  const {
    db,
    runTransaction,
    doc,
    collection,
    getDocs,
    query,
    where,
    serverTimestamp,
    onProgress,
  } = options;

  if (isSyncing) {
    console.log('[Sync] Proses sinkronisasi sedang berjalan...');
    return { success: false, inProgress: true };
  }

  if (!navigator.onLine) {
    console.log('[Sync] Perangkat sedang offline. Menunda sinkronisasi.');
    return { success: false, isOffline: true };
  }

  const pendingList = await getPendingOfflineTransactions();
  if (!pendingList.length) {
    return { success: true, count: 0 };
  }

  isSyncing = true;
  let successCount = 0;
  let failCount = 0;

  try {
    for (let i = 0; i < pendingList.length; i++) {
      const trans = pendingList[i];

      // 1. Validasi transaksi sebelum pengiriman
      const validation = validateTransactionData(trans);
      if (!validation.valid) {
        console.error('[Sync] Transaksi tidak valid:', trans.number, validation.error);
        await updateTransactionSyncStatus(trans.id, 'Gagal dikirim', validation.error);
        failCount++;
        continue;
      }

      try {
        // 2. Proteksi Idempotency: Cek apakah nomor nota / idempotencyKey sudah ada di Firebase
        const q = query(
          collection(db, 'transactions'),
          where('number', '==', trans.number)
        );
        const existingDocs = await getDocs(q);

        if (!existingDocs.empty) {
          // Transaksi ternyata sudah pernah tercatat di server!
          console.log(`[Sync] Transaksi ${trans.number} sudah ada di server (Idempotent). Menandai 'Terkirim'.`);
          await updateTransactionSyncStatus(trans.id, 'Terkirim');
          successCount++;
          continue;
        }

        // 3. Eksekusi pengiriman transaksi & penyesuaian stok di Firebase
        const transactionRef = doc(collection(db, 'transactions'));
        const payload = {
          number: trans.number,
          idempotencyKey: trans.idempotencyKey || `idem-${trans.number}`,
          items: trans.items.map((it) => ({ ...it })),
          subtotal: Number(trans.subtotal || trans.total),
          discount: Number(trans.discount || 0),
          total: Number(trans.total),
          costTotal: Number(trans.costTotal || 0),
          paymentMethod: trans.paymentMethod || 'Tunai',
          received: Number(trans.received || trans.total),
          change: Number(trans.change || 0),
          customerName: trans.customerName || 'Umum',
          customerPhone: trans.customerPhone || '',
          notes: trans.notes || '',
          status: 'selesai',
          syncSource: 'pwa-offline-sync',
          createdAt: trans.createdAt ? new Date(trans.createdAt) : serverTimestamp(),
          syncedAt: serverTimestamp(),
        };

        if (runTransaction) {
          await runTransaction(db, async (tx) => {
            // Potong stok produk di Firebase jika produk ditemukan
            for (const item of trans.items) {
              if (item.id && !item.id.startsWith('local-') && !item.id.startsWith('demo-')) {
                const prodRef = doc(db, 'products', item.id);
                const prodSnap = await tx.get(prodRef);
                if (prodSnap.exists()) {
                  const prodData = prodSnap.data();
                  const curDisplay = Number(prodData.display) || 0;
                  const curWarehouse = Number(prodData.warehouse) || 0;
                  const fromDisplay = Math.min(curDisplay, item.qty);
                  tx.update(prodRef, {
                    display: Math.max(0, curDisplay - fromDisplay),
                    warehouse: Math.max(0, curWarehouse - (item.qty - fromDisplay)),
                    updatedAt: serverTimestamp(),
                  });
                }
              }
            }
            tx.set(transactionRef, payload);
          });
        } else {
          // Fallback setDoc langsung
          const { setDoc: directSetDoc } = options;
          await directSetDoc(transactionRef, payload);
        }

        // 4. Update status di IndexedDB menjadi "Terkirim"
        await updateTransactionSyncStatus(trans.id, 'Terkirim');
        successCount++;

        if (typeof onProgress === 'function') {
          onProgress(successCount, pendingList.length, trans);
        }
      } catch (err) {
        console.error(`[Sync] Gagal mengirim transaksi #${trans.number}:`, err);
        await updateTransactionSyncStatus(trans.id, 'Gagal dikirim', err.message || 'Koneksi terputus');
        failCount++;
      }
    }
  } finally {
    isSyncing = false;
  }

  const remaining = await getPendingCount();
  return {
    success: failCount === 0,
    processed: pendingList.length,
    successCount,
    failCount,
    remaining,
  };
}
