import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Import Modul PWA, IndexedDB & Sinkronisasi Offline
import {
  openOfflineDB,
  saveOfflineTransaction,
  getAllOfflineTransactions,
  getPendingOfflineTransactions,
  getPendingCount,
  cacheProductsLocally,
  getCachedProductsLocally,
} from "./offline-db.js";
import {
  syncPendingTransactions,
  requestBackgroundSync,
  validateTransactionData,
} from "./sync.js";
import {
  registerServiceWorker,
  initPWAEvents,
  promptInstallApp,
  isRunningStandalone,
  getOnlineStatus,
} from "./pwa.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDp-yVYrMzF1a84i-3_GcBlIsAk_rg1Zdk",
  authDomain: "toko-dani-77a00.firebaseapp.com",
  projectId: "toko-dani-77a00",
  storageBucket: "toko-dani-77a00.firebasestorage.app",
  messagingSenderId: "450873334306",
  appId: "1:450873334306:web:58eff76efbe18159d1487b",
  measurementId: "G-S9H7QL11LT",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

// DOM Helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Formatter Helpers
const num = (n) => {
  if (typeof n === "string") n = n.replace(/\./g, "").replace(",", ".").trim();
  return Number(n) || 0;
};
const money = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num(n));

const rawNumber = (n) => String(num(n));
const formatInputNumber = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? new Intl.NumberFormat("id-ID").format(Number(digits)) : "";
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

const dateFmt = (v) => {
  const d = v?.toDate
    ? v.toDate()
    : v instanceof Date
      ? v
      : new Date(v || Date.now());
  return isNaN(d)
    ? "-"
    : new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(d);
};

const getTodayDateString = () => {
  const now = new Date();
  return now.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
};

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const asDate = (value) =>
  value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value || Date.now());

const monthOptions = () => {
  const formatter = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - index);
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: formatter.format(date),
    };
  });
};

const isInActivePeriod = (value) => {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return false;
  if (state.periodMode === "today") return date >= todayStart();
  if (state.customSubmode === "single") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` === state.singleDate;
  }
  if (state.customSubmode === "range") {
    const start = new Date(`${state.rangeStart}T00:00:00`);
    const end = new Date(`${state.rangeEnd}T23:59:59.999`);
    return date >= start && date <= end;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` === state.filterMonth;
};

const activeReportData = () => ({
  transactions: state.transactions.filter((transaction) => transaction.status !== "dibatalkan" && isInActivePeriod(transaction.createdAt)),
  expenses: state.expenses.filter((expense) => isInActivePeriod(expense.createdAt)),
});

// Starter products (empty by default for clean production use)
const DEFAULT_PRODUCTS = [];

// Application State
const state = {
  page: "kasir", // 'kasir' | 'tambah-barang' | 'stok-barang' | 'keuangan'
  products: [],
  categories: ["Sembako", "Minuman", "Snack", "Sabun & Cuci", "Lain-lain"],
  transactions: [],
  expenses: [],
  stockMovements: [],
  settings: {
    storeName: "Toko Dani",
    address: "",
    phone: "",
    receiptFooter: "Terima kasih telah berbelanja di Toko Dani",
  },
  cart: [],
  search: "",
  category: "",
  stockFilter: "all", // 'all' | 'warning' | 'empty'
  stockSearch: "",
  discount: 0,
  received: 0, // Raw number without dots!
  busy: false,
  scannerStream: null,
  scannerFrame: 0,
  scannerControls: null,
  // PWA & Offline State
  isOnline: navigator.onLine,
  pendingOfflineCount: 0,
  offlineTransactions: [],
  canInstallPWA: false,
  // Customer info for current cart
  customerName: "Umum",
  customerPhone: "",
  // Financial filters:
  periodMode: "today", // 'today' | 'custom'
  customSubmode: "single", // 'single' | 'range' | 'month'
  singleDate: new Date().toISOString().slice(0, 10),
  rangeStart: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
  rangeEnd: new Date().toISOString().slice(0, 10),
  filterMonth: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
  // Modal targets
  restockTarget: null,
  activeTransaction: null,
};

// UI Notifications
function toast(message, icon = "check_circle") {
  const el = $("#toast");
  const msgEl = $("#toast-msg");
  const iconEl = $("#toast-icon");
  if (!el || !msgEl) return;
  msgEl.textContent = message;
  if (iconEl) iconEl.textContent = icon;
  el.classList.remove("opacity-0", "-translate-y-2", "pointer-events-none");
  el.classList.add("opacity-100", "translate-y-0");
  setTimeout(() => {
    el.classList.remove("opacity-100", "translate-y-0");
    el.classList.add("opacity-0", "-translate-y-2", "pointer-events-none");
  }, 2200);
}

// Data synchronization with Firebase Firestore & IndexedDB Cache
async function loadAll() {
  try {
    state.isOnline = navigator.onLine;

    // 1. Coba koneksi & ambil data terbaru dari Firebase jika online
    if (navigator.onLine) {
      if (!auth.currentUser) await signInAnonymously(auth);
      const names = ["products", "transactions", "expenses", "stockMovements"];
      const vals = await Promise.all(
        names.map((n) => getDocs(collection(db, n))),
      );
      const [prodDocs, transDocs, expDocs, moveDocs] = vals;

      state.products = prodDocs.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.transactions = transDocs.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.expenses = expDocs.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.stockMovements = moveDocs.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // Cache daftar produk ke IndexedDB untuk cadangan saat offline
      if (state.products.length) {
        await cacheProductsLocally(state.products);
      }

      const st = await getDoc(doc(db, "settings", "main"));
      if (st.exists()) {
        state.settings = { ...state.settings, ...st.data() };
      }
    } else {
      // 2. Jika offline, muat produk dari cache IndexedDB
      console.log('[App] Mode Offline: Memuat produk dari IndexedDB');
      const cached = await getCachedProductsLocally();
      if (cached && cached.length) {
        state.products = cached;
      }
    }
  } catch (err) {
    console.warn("Firestore connection notice:", err);
    // Fallback muat dari cache IndexedDB jika Firestore gagal
    const cached = await getCachedProductsLocally();
    if (cached && cached.length) {
      state.products = cached;
    }
  } finally {
    // Muat antrean transaksi offline dari IndexedDB
    await updateOfflineTransactionsStatus();

    // Jika online dan ada antrean transaksi, picu sinkronisasi otomatis
    if (navigator.onLine && state.pendingOfflineCount > 0) {
      setTimeout(() => window.sinkronkanSekarang(), 1500);
    }

    updateTopBar();
    render();
  }
}

// Total stock helper
const totalStock = (p) => num(p.warehouse) + num(p.display);
const isLowStock = (p) => totalStock(p) <= num(p.minStock) && totalStock(p) > 0;
const isEmptyStock = (p) => totalStock(p) <= 0;

// Helper untuk membaca antrean offline dari IndexedDB & mengupdate indikator UI
async function updateOfflineTransactionsStatus() {
  try {
    state.isOnline = navigator.onLine;
    const all = await getAllOfflineTransactions();
    state.offlineTransactions = all;
    state.pendingOfflineCount = all.filter(
      (t) => t.syncStatus === "Menunggu dikirim" || t.syncStatus === "Gagal dikirim",
    ).length;
  } catch (err) {
    console.warn("[App] Gagal membaca status antrean offline:", err);
  }
}

// Update TopBar text & active bottom nav state & PWA network badge
function updateTopBar() {
  const storeNameEl = $("#top-store-name");
  const dateLabelEl = $("#top-date-label");
  const pageTitleEl = $("#top-page-title");

  if (storeNameEl)
    storeNameEl.textContent = state.settings.storeName || "Toko Dani";
  if (dateLabelEl) dateLabelEl.textContent = getTodayDateString();

  const titles = {
    kasir: "Kasir",
    "tambah-barang": "Tambah Barang",
    "stok-barang": "Stok Barang",
    keuangan: "Keuangan & Laporan",
  };
  if (pageTitleEl) pageTitleEl.textContent = titles[state.page] || "Kasir";

  // Update Status Jaringan & Indikator PWA di Header
  const netBadge = $("#network-status-badge");
  const netDot = $("#connection-dot");
  const netText = $("#connection-text");
  const pendingBadge = $("#offline-pending-badge");
  const installBtn = $("#btn-install-pwa");

  if (netBadge && netDot && netText) {
    if (state.isOnline) {
      netBadge.className =
        "px-2 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 transition-colors cursor-pointer shadow-2xs";
      netBadge.title = "Status Jaringan: Online (Klik untuk lihat antrean)";
      netDot.className = "inline-block w-2 h-2 rounded-full bg-emerald-500 transition-colors";
      netText.textContent = "Online";
    } else {
      netBadge.className =
        "px-2 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 bg-amber-50 text-amber-900 border border-amber-300 transition-colors cursor-pointer shadow-2xs";
      netBadge.title = "Status Jaringan: Offline (Transaksi disimpan ke perangkat)";
      netDot.className = "inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse transition-colors";
      netText.textContent = "Offline";
    }
  }

  // Tampilkan badge jumlah antrean yang belum terkirim
  if (pendingBadge) {
    if (state.pendingOfflineCount > 0) {
      pendingBadge.textContent = state.pendingOfflineCount;
      pendingBadge.classList.remove("hidden");
    } else {
      pendingBadge.classList.add("hidden");
    }
  }

  // Tampilkan tombol install PWA jika didukung browser
  if (installBtn) {
    if (state.canInstallPWA && !isRunningStandalone()) {
      installBtn.classList.remove("hidden");
      installBtn.classList.add("flex");
    } else {
      installBtn.classList.add("hidden");
      installBtn.classList.remove("flex");
    }
  }

  $$("#bottom-nav .nav-tab-item").forEach((a) => {
    const active = a.dataset.path === state.page;
    a.classList.toggle("active", active);
  });

  $$(".desktop-nav-item").forEach((btn) => {
    const active = btn.dataset.path === state.page;
    btn.classList.toggle("active", active);
    if (active) {
      btn.className =
        "desktop-nav-item active px-3.5 py-1.5 rounded-full text-[12.5px] font-bold bg-primary text-on-primary shadow-xs flex items-center gap-1.5 transition-all cursor-pointer";
    } else {
      btn.className =
        "desktop-nav-item px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-sand/80 flex items-center gap-1.5 transition-all cursor-pointer";
    }
  });
}

// Switch Page
window.pindahHalaman = (path) => {
  if (state.page === path) return;
  state.page = path;
  updateTopBar();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ========================================================
// 1. HALAMAN KASIR (POS) - MOBILE TUNED
// ========================================================

// Generator baris keranjang belanja
function renderCartRowsHtml() {
  if (!state.cart.length) {
    return `
    <div class="py-6 px-3 text-center text-text-muted-ink text-[12px] flex flex-col items-center justify-center gap-1.5">
      <div class="w-9 h-9 rounded-full bg-surface-sand flex items-center justify-center text-text-muted-ink/60">
        <span class="material-symbols-outlined text-[19px]">shopping_cart</span>
      </div>
      <span class="font-semibold text-text-primary-ink">Keranjang kosong</span>
      <span class="text-[11px] text-text-muted-ink">Pilih barang di katalog untuk menambahkan</span>
    </div>`;
  }
  return state.cart
    .map(
      (item) => `
    <div class="flex items-center justify-between py-1 border-b border-border-warm-subtle/60 last:border-b-0">
      <div class="flex flex-col min-w-0 pr-2">
        <span class="text-[12.5px] font-semibold text-on-surface truncate">${esc(item.name)}</span>
        <span class="text-[11px] text-on-surface-variant">${money(item.price)} × ${item.qty}</span>
        <span class="text-[12.5px] font-bold text-primary">${money(item.price * item.qty)}</span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <div class="flex items-center bg-surface-sand rounded-lg p-0.5 border border-border-warm/70">
          <button aria-label="Kurangi" class="w-5 h-5 rounded bg-surface-container-lowest hover:bg-surface-sand text-on-surface flex items-center justify-center active:scale-95 transition-transform" type="button" onclick="window.ubahQtyKeranjang('${item.id}', -1)">
            <span class="material-symbols-outlined text-[13px]">remove</span>
          </button>
          <span class="w-5 text-center text-[12px] font-bold text-on-surface">${item.qty}</span>
          <button aria-label="Tambah" class="w-5 h-5 rounded bg-surface-container-lowest hover:bg-surface-sand text-primary flex items-center justify-center active:scale-95 transition-transform" type="button" onclick="window.ubahQtyKeranjang('${item.id}', 1)">
            <span class="material-symbols-outlined text-[13px]">add</span>
          </button>
        </div>
        <button aria-label="Hapus" class="w-5 h-5 rounded-lg text-outline hover:text-error hover:bg-danger-soft-bg flex items-center justify-center transition-colors" type="button" onclick="window.hapusDariKeranjang('${item.id}')">
          <span class="material-symbols-outlined text-[14px]">delete</span>
        </button>
      </div>
    </div>`,
    )
    .join("");
}

// Update DOM keranjang kasir secara presisi tanpa me-reset halaman / animasi
function updateKasirCartInPlace() {
  if (state.page !== "kasir" || !$("#cart-items-list")) {
    render();
    return;
  }

  const subtotal = state.cart.reduce((a, x) => a + x.qty * x.price, 0);
  const discount = Math.min(subtotal, num(state.discount));
  const grand = Math.max(0, subtotal - discount);
  const received = num(state.received);
  const kembalian = Math.max(0, received - grand);

  // 1. Update List Item & Badge
  const cartList = $("#cart-items-list");
  if (cartList) cartList.innerHTML = renderCartRowsHtml();

  const countBadge = $("#cart-badge-count");
  if (countBadge) countBadge.textContent = `${state.cart.length} item`;

  const clearBtnWrapper = $("#cart-clear-btn-wrapper");
  if (clearBtnWrapper) {
    clearBtnWrapper.innerHTML = state.cart.length
      ? `<button type="button" class="text-[11.5px] text-danger-solid hover:underline font-semibold" onclick="window.kosongkanKeranjang()">Kosongkan</button>`
      : "";
  }

  // 2. Update Ringkasan Tagihan
  const subtotalEl = $("#label-subtotal-val");
  if (subtotalEl) subtotalEl.textContent = money(subtotal);

  const grandEl = $("#label-grand-val");
  if (grandEl) grandEl.textContent = money(grand);

  const uangPasText = $("#label-uang-pas-btn");
  if (uangPasText) uangPasText.textContent = `Uang Pas (${money(grand)})`;

  const uangPasBtn = $("#btn-uang-pas");
  if (uangPasBtn)
    uangPasBtn.setAttribute("onclick", `window.setUangPas(${grand})`);

  const kembalianEl = $("#label-kembalian");
  if (kembalianEl) kembalianEl.textContent = money(kembalian);

  // 3. Update Tombol Bayar
  const btnBayar = $("#btn-proses-bayar");
  const labelBayar = $("#label-bayar-btn");
  if (labelBayar)
    labelBayar.textContent = state.busy
      ? "Memproses..."
      : `Bayar ${money(grand)}`;
  if (btnBayar) {
    if (!state.cart.length || state.busy) {
      btnBayar.disabled = true;
      btnBayar.classList.add("opacity-60", "cursor-not-allowed");
    } else {
      btnBayar.disabled = false;
      btnBayar.classList.remove("opacity-60", "cursor-not-allowed");
    }
  }
}

function renderKasir() {
  const filteredProducts = state.products.filter((p) => {
    if (p.archived) return false;
    const matchSearch =
      !state.search ||
      `${p.name} ${p.code || ""}`
        .toLowerCase()
        .includes(state.search.toLowerCase());
    const matchCategory = !state.category || p.category === state.category;
    return matchSearch && matchCategory;
  });

  const subtotal = state.cart.reduce((a, x) => a + x.qty * x.price, 0);
  const discount = Math.min(subtotal, num(state.discount));
  const grand = Math.max(0, subtotal - discount);
  const received = num(state.received);
  const kembalian = Math.max(0, received - grand);

  // Category chips
  const categoryChips = [
    `<button type="button" class="px-2.5 py-1 rounded-full text-[12px] font-semibold shrink-0 shadow-xs transition-transform active:scale-95 flex items-center gap-1 ${
      !state.category
        ? "bg-primary text-on-primary"
        : "bg-surface-container-warm hover:bg-surface-sand text-on-surface-variant border border-border-warm-subtle"
    }" onclick="window.setPosCategory('')"><span class="material-symbols-outlined text-[15px]">apps</span> Semua</button>`,
    ...state.categories.map((c) => {
      const active = state.category === c;
      return `<button type="button" class="px-2.5 py-1 rounded-full text-[12px] font-medium shrink-0 border border-border-warm-subtle transition-colors flex items-center gap-1 ${
        active
          ? "bg-primary text-on-primary font-semibold"
          : "bg-surface-container-warm hover:bg-surface-sand text-on-surface-variant"
      }" onclick="window.setPosCategory('${esc(c)}')">${esc(c)}</button>`;
    }),
  ].join("");

  // Product cards
  const productCards = filteredProducts.length
    ? filteredProducts
        .map((p) => {
          const stock = totalStock(p);
          return `
      <div class="product-card bg-surface-container-lowest p-2 rounded-xl border border-border-warm-subtle flex flex-col justify-between shadow-xs hover:border-primary/40 transition-colors">
        <div class="flex flex-col mb-1.5">
          <div class="flex items-center justify-between gap-1 mb-1">
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-sand text-text-muted-ink border border-border-warm-subtle truncate max-w-[70px]">${esc(p.category || "Umum")}</span>
            <span class="text-[10.5px] font-semibold ${stock <= num(p.minStock) ? "text-danger-solid" : "text-green-badge-text"}">Stok: ${stock}</span>
          </div>
          <h4 class="text-[12.5px] font-bold text-on-surface line-clamp-2 leading-tight">${esc(p.name)}</h4>
          <span class="text-[13.5px] font-extrabold text-primary mt-1">${money(p.sellPrice)}</span>
        </div>
        <button class="w-full h-7 bg-surface-sand hover:bg-primary hover:text-on-primary text-primary rounded-lg text-[11.5px] font-bold flex items-center justify-center gap-1 border border-border-warm-subtle transition-colors active:scale-95" type="button" onclick="window.tambahKeKeranjang('${p.id}')">
          <span class="material-symbols-outlined text-[15px]">add</span> Tambah
        </button>
      </div>`;
        })
        .join("")
    : state.products.length === 0
      ? `
      <div class="col-span-full py-12 px-4 text-center flex flex-col items-center justify-center gap-3 bg-surface-container-lowest border border-dashed border-border-warm rounded-2xl shadow-xs">
        <div class="w-12 h-12 rounded-full bg-surface-sand flex items-center justify-center text-primary">
          <span class="material-symbols-outlined text-[26px]">storefront</span>
        </div>
        <div class="flex flex-col gap-1 max-w-sm">
          <h4 class="text-[14.5px] font-bold text-on-surface">Warung Siap Digunakan!</h4>
          <p class="text-[12px] text-text-muted-ink">Belum ada barang di katalog toko. Silakan tambahkan barang dagangan Ibu untuk mulai transaksi kasir.</p>
        </div>
        <button type="button" onclick="window.pindahHalaman('tambah-barang')" class="h-11 px-5 rounded-xl bg-primary text-on-primary text-[13px] font-bold flex items-center gap-1.5 shadow-xs hover:opacity-95 transition-all cursor-pointer active:scale-95">
          <span class="material-symbols-outlined text-[18px]">add_circle</span>
          <span>Tambah Barang Pertama</span>
        </button>
      </div>`
      : `<div class="col-span-full py-8 text-center text-text-muted-ink text-[13px] bg-surface-container-lowest rounded-xl border border-border-warm-subtle">Barang "${esc(state.search)}" tidak ditemukan.</div>`;

  // Cart rows generator
  const cartRows = renderCartRowsHtml();

  return `
  <div class="pos-desktop-wrapper w-full">
    <div class="lg:grid lg:grid-cols-12 lg:gap-5 items-start">
      <!-- KOLOM KIRI (Layar Komputer: 7/12 atau 8/12 lebar): Pencarian, Barcode & Katalog Produk -->
      <div class="pos-catalog-col lg:col-span-7 xl:col-span-8 flex flex-col gap-2.5">
        <!-- SEARCH & SCAN: Input Lebih Lebar & Tombol Barcode di Bawah Input -->
        <div class="bg-surface-container-lowest p-3 rounded-xl shadow-xs border border-border-warm-subtle flex flex-col gap-2">
          <!-- Input Pencarian Lebar Penuh (100%) - Tanpa Border Kotak -->
          <div id="pos-search-wrapper" class="input-box-wrapper w-full flex items-center bg-surface-sand/65 px-3 rounded-xl h-10.5 border-0 focus-within:bg-surface-cream transition-all">
            <span class="material-symbols-outlined text-outline text-[19px] mr-2 shrink-0">search</span>
            <input class="w-full bg-transparent text-[13.5px] text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none border-0" id="pos-search-input" placeholder="Cari nama barang atau ketik barcode..." type="text" value="${esc(state.search)}" oninput="window.handlePosSearch(this.value)">
            ${
              state.search
                ? `<button type="button" class="text-text-muted-ink hover:text-danger-solid p-1" onclick="window.clearSearch()"><span class="material-symbols-outlined text-[16px]">close</span></button>`
                : ""
            }
          </div>

          <!-- Tombol Barcode di Bawah Input & Filter Kategori -->
          <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <button class="h-7.5 px-3 bg-surface-container-warm hover:bg-surface-container text-primary font-semibold text-[11.5px] rounded-full flex items-center gap-1 border border-border-warm-subtle transition-colors shrink-0 shadow-xs active:scale-95 cursor-pointer" type="button" onclick="window.startBarcodeScanner()">
              <span class="material-symbols-outlined text-[16px] text-primary">barcode_scanner</span>
              <span>Scan Barcode</span>
            </button>
            <div class="h-4 w-px bg-border-warm/70 shrink-0"></div>
            ${categoryChips}
          </div>
        </div>

        <!-- KATALOG PRODUK CEPAT: Responsif 2 kolom di HP, 3-4 kolom di Komputer -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between px-0.5">
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-primary text-[17px]">verified</span>
              <h3 class="text-[13.5px] font-bold text-on-surface">Produk Toko</h3>
            </div>
            <span class="text-[11.5px] text-on-surface-variant font-medium">${filteredProducts.length} item</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
            ${productCards}
          </div>
        </div>
      </div>

      <!-- KOLOM KANAN (Layar Komputer: 5/12 atau 4/12 lebar): Keranjang & Checkout (Sticky di Layar Komputer) -->
      <div class="pos-sidebar-col lg:col-span-5 xl:col-span-4 flex flex-col gap-2.5 mt-2.5 lg:mt-0 lg:sticky lg:top-20">
        <!-- KERANJANG PESANAN -->
        <div class="bg-surface-container-lowest p-2.5 rounded-xl border border-border-warm-subtle shadow-xs flex flex-col gap-1.5">
          <div class="flex items-center justify-between pb-1 border-b border-border-warm-subtle">
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-primary text-[17px]">shopping_bag</span>
              <h3 class="text-[13px] font-bold text-on-surface">Pesanan</h3>
              <span id="cart-badge-count" class="text-[10.5px] px-1.5 py-0.2 rounded-full bg-surface-sand text-on-surface-variant font-medium border border-border-warm-subtle">${state.cart.length} item</span>
            </div>
            <div id="cart-clear-btn-wrapper">
              ${
                state.cart.length
                  ? `<button type="button" class="text-[11.5px] text-danger-solid hover:underline font-semibold cursor-pointer" onclick="window.kosongkanKeranjang()">Kosongkan</button>`
                  : ""
              }
            </div>
          </div>
          <div id="cart-items-list" class="flex flex-col max-h-[220px] lg:max-h-[260px] overflow-y-auto no-scrollbar">
            ${cartRows}
          </div>
        </div>

        <!-- RINGKASAN PEMBAYARAN: Bersih Tanpa Teks Diskon Ganda & Opsi Uang Pas / Nominal Polos -->
        <div class="bg-surface-container-lowest p-3 rounded-xl border border-border-warm-subtle shadow-xs flex flex-col gap-2.5">
          <!-- Subtotal & Diskon (HANYA SATU BARIS DISKON BERSIH) -->
          <div class="flex flex-col gap-1 pb-1.5 border-b border-border-warm-subtle text-[12.5px]">
            <div class="flex justify-between items-center text-on-surface-variant">
              <span>Subtotal</span>
              <span class="font-bold text-on-surface" id="label-subtotal-val">${money(subtotal)}</span>
            </div>
            <div class="flex justify-between items-center text-secondary">
              <label for="pos-discount" class="flex items-center gap-1 font-semibold cursor-pointer">
                <span class="material-symbols-outlined text-[15px]">local_offer</span> Diskon
              </label>
              <div class="flex items-center gap-1">
                <span class="font-bold text-[12px]">- Rp</span>
                <input class="w-20 text-right bg-surface-sand border border-border-warm rounded-lg px-2 py-0.5 text-[12.5px] font-bold text-secondary focus:outline-none focus:border-secondary" id="pos-discount" type="text" inputmode="numeric" data-money-input placeholder="0" value="${state.discount ? formatInputNumber(state.discount) : ""}" oninput="window.formatNominalInput(this); window.setDiskon(this.value)">
              </div>
            </div>
          </div>

          <!-- Total Tagihan -->
          <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-sand/80 border border-border-warm">
            <span class="text-[13px] font-bold text-on-surface">Total Tagihan</span>
            <span class="text-[17px] font-extrabold text-primary tracking-tight" id="label-grand-val">${money(grand)}</span>
          </div>

          <!-- OPSI PEMBAYARAN TUNAI: HANYA 2 OPSI ("Uang Pas" dan "Ketik Nominal") -->
          <div class="flex flex-col gap-1.5">
            <span class="text-[11.5px] font-semibold text-on-surface-variant">Pilihan Uang Tunai:</span>
            <div class="grid grid-cols-2 gap-1.5">
              <button id="btn-uang-pas" class="h-9 bg-surface-sand hover:bg-surface-container-warm text-on-surface rounded-lg text-[12px] font-bold border border-border-warm transition-colors active:scale-95 flex items-center justify-center gap-1 cursor-pointer" onclick="window.setUangPas(${grand})" type="button">
                <span class="material-symbols-outlined text-[15px] text-primary">payments</span>
                <span id="label-uang-pas-btn">Uang Pas (${money(grand)})</span>
              </button>
              <button class="h-9 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-[12px] font-bold border border-primary/30 transition-colors active:scale-95 flex items-center justify-center gap-1 cursor-pointer" onclick="window.fokusNominal()" type="button">
                <span class="material-symbols-outlined text-[15px]">edit</span>
                <span>Ketik Nominal</span>
              </button>
            </div>
          </div>

          <!-- INPUT UANG DITERIMA: TIDAK DITITIKIN (Misal 10000 tetap 10000) -->
          <div class="flex flex-col gap-1">
            <div class="input-box-wrapper flex items-center justify-between bg-surface-sand/70 px-2.5 rounded-lg h-9.5 border border-border-warm focus-within:border-primary/60 transition-colors">
              <span class="text-[12px] text-on-surface-variant font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-outline">point_of_sale</span> Uang Diterima
              </span>
              <div class="flex items-center gap-1 font-bold text-on-surface">
                <span class="text-[12.5px] text-on-surface-variant">Rp</span>
                <input class="w-24 text-right bg-transparent text-[14px] font-extrabold text-on-surface focus:outline-none border-0" id="uang-diterima" type="text" inputmode="numeric" data-money-input placeholder="0" value="${state.received ? formatInputNumber(state.received) : ""}" oninput="window.formatNominalInput(this); window.setUangDiterima(this.value)">
              </div>
            </div>

            <!-- Nama Pelanggan (Data Pelanggan) -->
            <div class="input-box-wrapper flex items-center justify-between bg-surface-sand/70 px-2.5 rounded-lg h-8.5 border border-border-warm focus-within:border-primary/60 transition-colors">
              <span class="text-[11.5px] text-on-surface-variant font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-[14px] text-outline">person</span> Pelanggan
              </span>
              <input class="w-32 text-right bg-transparent text-[12px] font-semibold text-on-surface focus:outline-none border-0" id="pos-customer-name" type="text" placeholder="Nama / Umum" value="${esc(state.customerName || "Umum")}" oninput="window.setCustomerName(this.value)">
            </div>

            <!-- Kembalian -->
            <div class="flex items-center justify-between px-2.5 py-1 rounded-lg bg-green-badge-bg/70 border border-primary/25">
              <div class="flex items-center gap-1 text-primary">
                <span class="material-symbols-outlined text-[15px]">savings</span>
                <span class="text-[11.5px] font-semibold">Kembalian</span>
              </div>
              <span class="text-[13.5px] font-extrabold text-primary" id="label-kembalian">${money(kembalian)}</span>
            </div>
          </div>
        </div>

        <!-- TOMBOL AKSI UTAMA -->
        <div class="flex flex-col gap-1.5 pt-0.5 pb-2">
          <button id="btn-proses-bayar" class="w-full h-11 bg-primary hover:bg-primary-container text-on-primary rounded-xl text-[14.5px] font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-[0.98] cursor-pointer ${
            !state.cart.length || state.busy ? "opacity-60 cursor-not-allowed" : ""
          }" type="button" onclick="window.prosesPembayaran()" ${!state.cart.length || state.busy ? "disabled" : ""}>
            <span class="material-symbols-outlined text-[19px]">check_circle</span>
            <span id="label-bayar-btn">${state.busy ? "Memproses..." : `Bayar ${money(grand)}`}</span>
          </button>
          <div class="grid grid-cols-2 gap-1.5">
            <button class="h-9 bg-surface-container-lowest hover:bg-surface-sand text-on-surface border border-border-warm rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1 transition-colors active:scale-95 cursor-pointer" type="button" onclick="window.cetakNotaTerakhir()">
              <span class="material-symbols-outlined text-outline text-[15px]">receipt</span>
              <span>Cetak Nota</span>
            </button>
            <button class="h-9 bg-surface-container-lowest hover:bg-danger-soft-bg text-outline hover:text-error border border-border-warm rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1 transition-colors active:scale-95 cursor-pointer" type="button" onclick="window.kosongkanKeranjang()">
              <span class="material-symbols-outlined text-[15px]">close</span>
              <span>Batal</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// POS Handlers
window.handlePosSearch = (val) => {
  state.search = val;
  const input = $("#pos-search-input");
  const pos = input ? input.selectionStart : null;
  render();
  const newInput = $("#pos-search-input");
  if (newInput && pos !== null) {
    newInput.focus();
    newInput.setSelectionRange(pos, pos);
  }
};

window.clearSearch = () => {
  state.search = "";
  render();
  $("#pos-search-input")?.focus();
};

window.setPosCategory = (cat) => {
  state.category = cat;
  render();
};

window.tambahKeKeranjang = (productId) => {
  const prod = state.products.find((p) => p.id === productId);
  if (!prod) return;
  const exist = state.cart.find((i) => i.id === productId);
  if (exist) {
    exist.qty += 1;
  } else {
    state.cart.push({
      id: prod.id,
      name: prod.name,
      price: num(prod.sellPrice),
      qty: 1,
    });
  }
  toast(`${prod.name} ditambahkan!`);
  updateKasirCartInPlace();
};

window.ubahQtyKeranjang = (id, delta) => {
  const item = state.cart.find((i) => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    state.cart = state.cart.filter((i) => i.id !== id);
  }
  updateKasirCartInPlace();
};

window.hapusDariKeranjang = (id) => {
  state.cart = state.cart.filter((i) => i.id !== id);
  updateKasirCartInPlace();
};

window.kosongkanKeranjang = () => {
  state.cart = [];
  state.discount = 0;
  state.received = 0;
  const posDisc = $("#pos-discount");
  if (posDisc) posDisc.value = "";
  const uangRec = $("#uang-diterima");
  if (uangRec) uangRec.value = "";
  toast("Keranjang dikosongkan");
  updateKasirCartInPlace();
};

window.setDiskon = (val) => {
  state.discount = num(val);
  updateKasirCartInPlace();
};

// Pilihan Uang: Uang Pas
window.setUangPas = (total) => {
  state.received = total;
  const inputUang = $("#uang-diterima");
  if (inputUang) {
    inputUang.value = rawNumber(total); // Plain number, NO DOTS!
  }
  updateKasirCartInPlace();
};

// Pilihan Uang: Ketik Nominal
window.fokusNominal = () => {
  const input = $("#uang-diterima");
  if (input) {
    input.focus();
    input.select();
  }
};

// Helper input nama pelanggan di kasir
window.setCustomerName = (val) => {
  state.customerName = val.trim() || "Umum";
};

// Input Uang Diterima: update value without dots
window.setUangDiterima = (val) => {
  state.received = num(val);
  updateKasirCartInPlace();
};

window.formatNominalInput = (input) => {
  const cursorFromEnd = input.value.length - (input.selectionStart || input.value.length);
  input.value = formatInputNumber(input.value);
  const pos = Math.max(0, input.value.length - cursorFromEnd);
  input.setSelectionRange(pos, pos);
};

// Proses Pembayaran Kasir (Online dengan Firebase & Offline dengan IndexedDB)
window.prosesPembayaran = async () => {
  if (!state.cart.length)
    return toast("Keranjang belanja masih kosong!", "warning");

  // Validasi stok lokal lebih dulu agar barang habis tidak pernah dianggap sukses.
  for (const item of state.cart) {
    const product = state.products.find((p) => p.id === item.id);
    if (!product) {
      state.busy = false;
      return alert(`Transaksi dibatalkan: data barang ${item.name} tidak ditemukan.`);
    }
    const available = totalStock(product);
    if (available < num(item.qty)) {
      state.busy = false;
      return alert(`Transaksi dibatalkan: stok ${item.name} tidak cukup. Tersedia ${available}, diminta ${item.qty}.`);
    }
  }

  const subtotal = state.cart.reduce((a, x) => a + x.qty * x.price, 0);
  const discount = Math.min(subtotal, num(state.discount));
  const grand = Math.max(0, subtotal - discount);
  const received = num(state.received);

  if (received < grand) {
    return alert(
      `Uang yang diterima masih kurang!\nTotal: ${money(grand)}\nDiterima: ${money(received)}`,
    );
  }

  // Siapkan objek transaksi lengkap dengan ID unik, waktu pembuatan, detail produk, & data pelanggan
  const number = `TD-${Date.now().toString().slice(-8)}`;
  const change = received - grand;
  const idempotencyKey = `idem-${number}-${Math.random().toString(36).slice(2, 8)}`;
  const customerName = state.customerName || "Umum";
  const customerPhone = state.customerPhone || "";

  const transData = {
    number,
    idempotencyKey,
    items: state.cart.map((i) => ({ ...i })),
    subtotal,
    discount,
    total: grand,
    costTotal: state.cart.reduce((acc, item) => {
      const p = state.products.find((prod) => prod.id === item.id);
      return acc + num(p?.buyPrice) * item.qty;
    }, 0),
    paymentMethod: "Tunai",
    received,
    change,
    customerName,
    customerPhone,
    status: "selesai",
    createdAt: new Date().toISOString(),
  };

  // Validasi data transaksi sebelum diproses
  const validation = validateTransactionData(transData);
  if (!validation.valid) {
    return alert(`Validasi transaksi gagal: ${validation.error}`);
  }

  state.busy = true;
  render();

  // SKENARIO 1: JIKA PERANGKAT SEDANG ONLINE -> KIRIM LANGSUNG KE FIREBASE
  if (navigator.onLine) {
    try {
      const transactionRef = doc(collection(db, "transactions"));
      await runTransaction(db, async (tx) => {
        const productRefs = state.cart.map((item) => doc(db, "products", item.id));
        const snapshots = await Promise.all(productRefs.map((ref) => tx.get(ref)));
        const nextStock = new Map();

        snapshots.forEach((snapshot, index) => {
          const item = state.cart[index];
          if (!snapshot.exists()) {
            const stockError = new Error(`Barang ${item.name} tidak ditemukan di server.`);
            stockError.code = "INSUFFICIENT_STOCK";
            throw stockError;
          }
          const product = snapshot.data();
          const available = num(product.display) + num(product.warehouse);
          if (available < item.qty) {
            const stockError = new Error(`Stok ${item.name} tidak cukup. Tersedia ${available}, diminta ${item.qty}.`);
            stockError.code = "INSUFFICIENT_STOCK";
            throw stockError;
          }
          const display = num(product.display);
          const fromDisplay = Math.min(display, item.qty);
          nextStock.set(item.id, {
            display: display - fromDisplay,
            warehouse: num(product.warehouse) - (item.qty - fromDisplay),
          });
        });

        nextStock.forEach((stock, id) => {
          tx.update(doc(db, "products", id), { ...stock, updatedAt: serverTimestamp() });
        });
        tx.set(transactionRef, {
          ...transData,
          createdAt: serverTimestamp(),
          syncedAt: serverTimestamp(),
        });
      });

      // Update stok lokal di memori
      state.cart.forEach((item) => {
        const p = state.products.find((prod) => prod.id === item.id);
        if (!p) return;
        const fromDisplay = Math.min(num(p.display), item.qty);
        p.display = num(p.display) - fromDisplay;
        p.warehouse = Math.max(0, num(p.warehouse) - (item.qty - fromDisplay));
      });

      // Simpan pembaruan stok ke IndexedDB
      await cacheProductsLocally(state.products);

      const completed = {
        ...transData,
        id: transactionRef.id,
        createdAt: new Date(),
        syncStatus: "Terkirim",
      };

      state.transactions.unshift(completed);
      state.cart = [];
      state.discount = 0;
      state.received = 0;
      state.customerName = "Umum";
      state.customerPhone = "";
      state.busy = false;

      toast("Pembayaran berhasil & tersinkronkan!", "cloud_done");
      render();
      window.bukaNotaModal(completed);
      return;
    } catch (err) {
      if (err.code === "INSUFFICIENT_STOCK") {
        state.busy = false;
        render();
        return alert(`Transaksi dibatalkan: ${err.message}`);
      }
      console.warn("[Pembayaran Online Gagal, Mengalihkan ke Mode Offline]:", err);
      // Jika proses online gagal di tengah jalan, fallback simpan ke IndexedDB offline
    }
  }

  // SKENARIO 2: JIKA OFFLINE ATAU KONEKSI FIREBASE TERPUTUS
  try {
    for (const item of state.cart) {
      const product = state.products.find((p) => p.id === item.id);
      if (product && totalStock(product) < item.qty) {
        state.busy = false;
        render();
        return alert(`Transaksi dibatalkan: stok ${item.name} tidak cukup. Tersedia ${totalStock(product)}.`);
      }
    }
    // Simpan ke IndexedDB dengan status "Menunggu dikirim"
    const savedOffline = await saveOfflineTransaction({
      ...transData,
      id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    });

    // Kurangi stok di memori lokal agar kasir tidak menjual barang habis
    state.cart.forEach((item) => {
      const p = state.products.find((prod) => prod.id === item.id);
      if (!p) return;
      const fromDisplay = Math.min(num(p.display), item.qty);
      p.display = Math.max(0, num(p.display) - fromDisplay);
      p.warehouse = Math.max(0, num(p.warehouse) - (item.qty - fromDisplay));
    });

    // Simpan pembaruan stok ke IndexedDB
    await cacheProductsLocally(state.products);

    // Daftarkan Background Sync agar terkirim otomatis saat online
    await requestBackgroundSync();

    // Perbarui counter antrean offline
    await updateOfflineTransactionsStatus();

    const completed = {
      ...savedOffline,
      createdAt: new Date(),
    };

    state.transactions.unshift(completed);
    state.cart = [];
    state.discount = 0;
    state.received = 0;
    state.customerName = "Umum";
    state.customerPhone = "";
    state.busy = false;

    toast("Transaksi disimpan OFFLINE (Menunggu dikirim)", "cloud_off");
    render();
    window.bukaNotaModal(completed);
  } catch (offlineErr) {
    state.busy = false;
    render();
    alert("Gagal menyimpan transaksi offline: " + offlineErr.message);
  }
};

window.cetakNotaTerakhir = () => {
  if (state.transactions.length) {
    window.bukaNotaModal(state.transactions[0]);
  } else {
    toast("Belum ada riwayat transaksi", "info");
  }
};

// ========================================================
// 2. HALAMAN TAMBAH BARANG - RESPONSIVE (MOBILE & DESKTOP)
// ========================================================
function renderTambahBarang() {
  return `
  <div class="flex flex-col w-full gap-2.5 max-w-2xl lg:max-w-3xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between pb-1 border-b border-border-warm-subtle/80">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0 shadow-xs">
          <span class="material-symbols-outlined text-[19px]">add_box</span>
        </div>
        <h1 class="text-[15.5px] font-bold text-text-primary-ink">Tambah Barang Baru</h1>
      </div>
      <button type="button" onclick="window.resetAddForm()" class="text-text-muted-ink hover:text-danger-solid p-1 rounded transition-colors flex items-center gap-1 text-[12px] font-medium cursor-pointer">
        <span class="material-symbols-outlined text-[16px]">restart_alt</span>
        <span>Reset</span>
      </button>
    </div>

    <!-- Form Tambah Barang (Responsif di Layar Komputer) -->
    <form id="add-product-form" onsubmit="event.preventDefault(); window.simpanBarangBaru();" class="flex flex-col gap-2.5">
      <!-- Grid 2 Kolom di Desktop: Nama Barang & Barcode -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <!-- Nama Barang -->
        <div class="flex flex-col gap-1 bg-surface-cream rounded-xl p-3 shadow-xs border border-border-warm-subtle">
          <label for="product-name" class="text-[12.5px] font-semibold text-text-primary-ink flex items-center gap-1">
            <span class="material-symbols-outlined text-primary text-[17px]">shopping_bag</span>
            <span>Nama Barang</span>
            <span class="text-secondary font-bold">*</span>
          </label>
          <input type="text" id="product-name" required placeholder="Contoh: Kopi Kapal Api 65gr" class="w-full h-10.5 px-3 rounded-lg bg-surface-sand border border-border-warm-subtle text-text-primary-ink text-[13.5px] focus:bg-surface-cream focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all placeholder:text-text-muted-ink/50">
        </div>

        <!-- Kode / Barcode -->
        <div class="flex flex-col gap-1 bg-surface-cream rounded-xl p-3 shadow-xs border border-border-warm-subtle min-w-0 overflow-hidden">
          <label for="product-code" class="text-[12.5px] font-semibold text-text-primary-ink flex items-center justify-between">
            <span class="flex items-center gap-1">
              <span class="material-symbols-outlined text-primary text-[17px]">qr_code_scanner</span>
              <span>Kode / Barcode</span>
            </span>
          </label>
          <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full py-0.5">
            <input type="text" id="product-code" placeholder="Barcode / Kode unik" class="min-w-[130px] flex-1 h-10.5 px-3 rounded-lg bg-surface-sand border border-border-warm-subtle text-text-primary-ink font-mono text-[13px] focus:bg-surface-cream focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all placeholder:text-text-muted-ink/50 shrink-0 sm:shrink">
            <button type="button" onclick="window.generateAutoCode()" title="Kode Otomatis" class="h-10.5 px-2.5 rounded-lg bg-surface-sand hover:bg-surface-container-warm border border-border-warm-subtle text-text-primary-ink text-[12px] font-semibold flex items-center justify-center gap-1 active:scale-[0.98] transition-transform shrink-0 cursor-pointer">
              <span class="material-symbols-outlined text-[16px] text-primary">magic_button</span>
              <span>Otomatis</span>
            </button>
            <button type="button" onclick="window.startBarcodeScanner('product-code')" title="Scan Kamera" class="h-10.5 px-2.5 rounded-lg bg-surface-sand hover:bg-surface-container-warm border border-border-warm-subtle text-text-primary-ink text-[12px] font-semibold flex items-center justify-center gap-1 active:scale-[0.98] transition-transform shrink-0 cursor-pointer">
              <span class="material-symbols-outlined text-[16px] text-tertiary">barcode_scanner</span>
              <span>Scan</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Kategori -->
      <div class="flex flex-col gap-1 bg-surface-cream rounded-xl p-3 shadow-xs border border-border-warm-subtle">
        <label for="product-category" class="text-[12.5px] font-semibold text-text-primary-ink flex items-center gap-1">
          <span class="material-symbols-outlined text-primary text-[17px]">category</span>
          <span>Kategori</span>
          <span class="text-secondary font-bold">*</span>
        </label>
        <div class="relative">
          <select id="product-category" required class="w-full h-10.5 px-3 pr-10 rounded-lg bg-surface-sand border border-border-warm-subtle text-text-primary-ink text-[13.5px] focus:bg-surface-cream focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none appearance-none transition-all">
            <option value="" disabled selected>Pilih kategori...</option>
            ${state.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
          </select>
          <span class="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted-ink text-[20px]">arrow_drop_down</span>
        </div>
      </div>

      <!-- Harga Modal & Jual + Margin Preview -->
      <div class="bg-surface-cream rounded-xl p-3 shadow-xs border border-border-warm-subtle flex flex-col gap-2">
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1">
            <label for="cost-price" class="text-[12px] font-semibold text-text-primary-ink flex items-center gap-0.5">
              <span>Harga Modal</span>
              <span class="text-secondary font-bold">*</span>
            </label>
            <div class="relative flex items-center">
              <span class="absolute left-2.5 text-text-muted-ink text-[12px] select-none font-semibold">Rp</span>
              <input type="text" id="cost-price" inputmode="numeric" data-money-input value="4.000" oninput="window.formatNominalInput(this); window.recalculateMargin()" class="w-full h-10.5 pl-9 pr-2 rounded-lg bg-surface-sand border border-border-warm-subtle text-text-primary-ink font-bold text-[13.5px] focus:bg-surface-cream focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all">
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <label for="sell-price" class="text-[12px] font-semibold text-text-primary-ink flex items-center gap-0.5">
              <span>Harga Jual</span>
              <span class="text-secondary font-bold">*</span>
            </label>
            <div class="relative flex items-center">
              <span class="absolute left-2.5 text-primary text-[12px] select-none font-semibold">Rp</span>
              <input type="text" id="sell-price" inputmode="numeric" data-money-input value="5.500" oninput="window.formatNominalInput(this); window.recalculateMargin()" class="w-full h-10.5 pl-9 pr-2 rounded-lg bg-surface-sand border border-border-warm-subtle text-primary font-bold text-[13.5px] focus:bg-surface-cream focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all">
            </div>
          </div>
        </div>

        <!-- Profit Summary Strip -->
        <div id="profit-badge-container" class="mt-1 p-2.5 rounded-lg bg-green-badge-bg border border-green-fresh-vibrant/30 flex flex-col gap-1 transition-colors shadow-xs">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1">
              <span class="material-symbols-outlined text-primary text-[17px]" style="font-variation-settings: 'FILL' 1;">trending_up</span>
              <span class="text-[12px] text-green-badge-text font-bold">Estimasi Keuntungan</span>
            </div>
            <span id="margin-percentage" class="px-2 py-0.5 rounded-full bg-primary text-on-primary text-[11px] font-bold shrink-0">Laba 27%</span>
          </div>
          <div class="flex items-baseline justify-between">
            <span id="profit-value-display" class="text-[20px] leading-tight text-primary font-extrabold tracking-tight">+Rp 1.500</span>
            <span class="text-[11.5px] text-green-badge-text">per unit</span>
          </div>
          <p id="profit-advice" class="text-[11px] text-green-badge-text font-medium">Margin sehat untuk toko kelontong harian.</p>
        </div>
      </div>

      <!-- Stok Awal & Batas Peringatan -->
      <div class="bg-surface-cream rounded-xl p-3 shadow-xs border border-border-warm-subtle grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-1">
          <label for="initial-stock" class="text-[12px] font-semibold text-text-primary-ink">Stok Awal</label>
          <div class="flex items-center gap-1">
            <button type="button" onclick="window.adjustStock(-1)" aria-label="Kurangi stok" class="w-9 h-9 rounded-lg bg-surface-sand hover:bg-surface-container-warm border border-border-warm text-text-primary-ink active:scale-95 flex items-center justify-center shrink-0 transition-all select-none shadow-xs">
              <span class="material-symbols-outlined text-[19px]">remove</span>
            </button>
            <input type="number" id="initial-stock" min="0" value="24" class="flex-1 h-9 rounded-lg bg-surface-sand border border-border-warm-subtle text-center text-[15px] font-bold text-text-primary-ink focus:bg-surface-cream focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none min-w-0 transition-all">
            <button type="button" onclick="window.adjustStock(1)" aria-label="Tambah stok" class="w-9 h-9 rounded-lg bg-primary hover:bg-primary-container text-on-primary active:scale-[0.98] flex items-center justify-center shrink-0 transition-all select-none shadow-xs">
              <span class="material-symbols-outlined text-[19px]">add</span>
            </button>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <label for="minimum-stock-alert" class="text-[12px] font-semibold text-text-primary-ink flex items-center gap-0.5">
            <span class="material-symbols-outlined text-tertiary text-[15px]">warning</span>
            <span>Batas Peringatan</span>
          </label>
          <div class="relative flex items-center">
            <input type="number" id="minimum-stock-alert" min="1" value="5" class="w-full h-9 px-2.5 pr-10 rounded-lg bg-surface-sand border border-border-warm-subtle text-text-primary-ink text-[13.5px] font-bold focus:bg-surface-cream focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all">
            <span class="absolute right-2 text-[11px] text-text-muted-ink">sisa</span>
          </div>
        </div>
      </div>

      <!-- Tombol Simpan -->
      <div class="pt-0.5 pb-2">
        <button type="submit" id="btn-save-product" class="w-full h-11 rounded-xl bg-primary hover:bg-primary-container text-on-primary text-[14px] font-bold flex items-center justify-center gap-1.5 shadow-sm active:translate-y-0.5 transition-all select-none">
          <span class="material-symbols-outlined text-[18px]" style="font-variation-settings: 'FILL' 1;">check_circle</span>
          <span>Simpan Barang</span>
        </button>
      </div>
    </form>
  </div>`;
}

// Tambah Barang Handlers
window.recalculateMargin = () => {
  const costInput = $("#cost-price");
  const sellInput = $("#sell-price");
  const profitDisplay = $("#profit-value-display");
  const marginBadge = $("#margin-percentage");
  const adviceText = $("#profit-advice");
  const container = $("#profit-badge-container");

  if (!costInput || !sellInput || !profitDisplay) return;

  const cost = parseFloat(costInput.value) || 0;
  const sell = parseFloat(sellInput.value) || 0;
  const profit = sell - cost;

  if (cost > 0 && sell > 0) {
    const marginPct = Math.round((profit / sell) * 100);
    if (profit >= 0) {
      profitDisplay.textContent =
        "+Rp " + new Intl.NumberFormat("id-ID").format(profit);
      profitDisplay.className =
        "text-[20px] leading-tight text-primary font-extrabold tracking-tight";
      marginBadge.textContent = "Laba " + marginPct + "%";
      marginBadge.className =
        "px-2 py-0.5 rounded-full bg-primary text-on-primary text-[11px] font-bold shrink-0";
      adviceText.textContent =
        marginPct > 15
          ? "Margin sehat untuk toko kelontong harian."
          : "Keuntungan cukup tipis, pastikan perputaran cepat.";
      adviceText.className = "text-[11px] text-green-badge-text font-medium";
      container.className =
        "mt-1 p-2.5 rounded-lg bg-green-badge-bg border border-green-fresh-vibrant/30 flex flex-col gap-1 transition-colors shadow-xs";
    } else {
      profitDisplay.textContent =
        "-Rp " + new Intl.NumberFormat("id-ID").format(Math.abs(profit));
      profitDisplay.className =
        "text-[20px] leading-tight text-danger-solid font-extrabold tracking-tight";
      marginBadge.textContent = "Rugi " + Math.abs(marginPct) + "%";
      marginBadge.className =
        "px-2 py-0.5 rounded-full bg-danger-solid text-on-error text-[11px] font-bold shrink-0";
      adviceText.textContent = "Peringatan: Harga jual lebih murah dari modal!";
      adviceText.className = "text-[11px] text-danger-solid font-medium";
      container.className =
        "mt-1 p-2.5 rounded-lg bg-danger-soft-bg border border-danger-solid/30 flex flex-col gap-1 transition-colors shadow-xs";
    }
  } else {
    profitDisplay.textContent = "Rp 0";
    marginBadge.textContent = "Laba 0%";
    adviceText.textContent = "Ketik harga modal dan jual untuk kalkulasi laba.";
    adviceText.className = "text-[11px] text-text-muted-ink";
  }
};

window.adjustStock = (amount) => {
  const stockInput = $("#initial-stock");
  if (!stockInput) return;
  let currentVal = parseInt(stockInput.value, 10) || 0;
  stockInput.value = Math.max(0, currentVal + amount);
};

window.generateAutoCode = () => {
  const codeInput = $("#product-code");
  if (!codeInput) return;
  codeInput.value = "TK-" + Math.floor(10000000 + Math.random() * 90000000);
  codeInput.classList.add("bg-surface-container-warm");
  setTimeout(
    () => codeInput.classList.remove("bg-surface-container-warm"),
    300,
  );
};

window.resetAddForm = () => {
  if (confirm("Kosongkan isian formulir ini?")) {
    $("#add-product-form")?.reset();
    window.recalculateMargin();
    $("#product-name")?.focus();
  }
};

window.simpanBarangBaru = async () => {
  const name = $("#product-name")?.value.trim();
  const code =
    $("#product-code")?.value.trim() || `TK-${Date.now().toString().slice(-6)}`;
  const category = $("#product-category")?.value || "Lain-lain";
  const buyPrice = num($("#cost-price")?.value);
  const sellPrice = num($("#sell-price")?.value);
  const display = num($("#initial-stock")?.value);
  const minStock = num($("#minimum-stock-alert")?.value) || 5;

  if (!name) return alert("Mohon masukkan nama barang.");
  if (state.products.some((p) => String(p.code || "").trim() === code)) {
    return alert("Barcode tersebut sudah dipakai barang lain.");
  }

  const newProd = {
    name,
    code,
    category,
    buyPrice,
    sellPrice,
    display,
    warehouse: 0,
    minStock,
    baseUnit: "pcs",
  };

  try {
    const ref = await addDoc(collection(db, "products"), {
      ...newProd,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    state.products.push({ id: ref.id, ...newProd });
  } catch (err) {
    console.warn("Save local:", err);
    state.products.push({ id: `local-${Date.now()}`, ...newProd });
  }

  toast(`${name} berhasil disimpan!`);
  window.pindahHalaman("stok-barang");
};

window.editBarang = (id) => {
  const product = state.products.find((p) => p.id === id);
  if (!product) return alert("Barang tidak ditemukan.");
  const modalRoot = $("#modal-root");
  if (!modalRoot) return;
  modalRoot.innerHTML = `
    <div class="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" id="edit-product-modal">
      <div class="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-surface-cream rounded-t-2xl sm:rounded-2xl p-4 shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <div><h3 class="text-[16px] font-bold text-text-primary-ink">Edit Data Barang</h3><p class="text-[11.5px] text-text-muted-ink">Perubahan stok tidak akan ikut berubah.</p></div>
          <button type="button" class="w-8 h-8 rounded-full bg-surface-sand border border-border-warm flex items-center justify-center" onclick="window.tutupModalRoot()">×</button>
        </div>
        <form onsubmit="event.preventDefault(); window.simpanEditBarang('${esc(id)}');" class="flex flex-col gap-3">
          <label class="text-[12px] font-semibold">Nama Barang<input id="edit-product-name" required value="${esc(product.name)}" class="mt-1 w-full h-10 px-3 rounded-lg bg-surface-sand border border-border-warm text-[13px]"></label>
          <label class="text-[12px] font-semibold">Kode / Barcode<div class="mt-1 flex gap-1.5"><input id="edit-product-code" value="${esc(product.code || '')}" class="w-full h-10 px-3 rounded-lg bg-surface-sand border border-border-warm text-[13px] font-mono"><button type="button" onclick="window.startBarcodeScanner('edit-product-code')" class="h-10 px-3 rounded-lg bg-surface-sand border border-border-warm text-primary text-[12px] font-semibold flex items-center gap-1 shrink-0"><span class="material-symbols-outlined text-[16px]">barcode_scanner</span><span>Scan</span></button></div></label>
          <label class="text-[12px] font-semibold">Kategori<select id="edit-product-category" class="mt-1 w-full h-10 px-3 rounded-lg bg-surface-sand border border-border-warm text-[13px]">${state.categories.map((c) => `<option value="${esc(c)}" ${c === (product.category || 'Lain-lain') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <div class="grid grid-cols-2 gap-2">
            <label class="text-[12px] font-semibold">Harga Modal<input id="edit-buy-price" required value="${formatInputNumber(product.buyPrice)}" inputmode="numeric" oninput="window.formatNominalInput(this)" class="mt-1 w-full h-10 px-3 rounded-lg bg-surface-sand border border-border-warm text-[13px] font-bold"></label>
            <label class="text-[12px] font-semibold">Harga Jual<input id="edit-sell-price" required value="${formatInputNumber(product.sellPrice)}" inputmode="numeric" oninput="window.formatNominalInput(this)" class="mt-1 w-full h-10 px-3 rounded-lg bg-surface-sand border border-border-warm text-[13px] font-bold"></label>
          </div>
          <div class="flex gap-2 pt-1"><button type="button" onclick="window.tutupModalRoot()" class="flex-1 h-10 rounded-xl bg-surface-sand border border-border-warm text-[13px] font-semibold">Batal</button><button type="submit" class="flex-1 h-10 rounded-xl bg-primary text-on-primary text-[13px] font-bold">Simpan Perubahan</button></div>
        </form>
      </div>
    </div>`;
};

window.simpanEditBarang = async (id) => {
  const product = state.products.find((p) => p.id === id);
  if (!product) return;
  const name = $("#edit-product-name")?.value || "";
  const code = $("#edit-product-code")?.value || "";
  const category = $("#edit-product-category")?.value || "Lain-lain";
  const buyPrice = num($("#edit-buy-price")?.value);
  const sellPrice = num($("#edit-sell-price")?.value);
  const cleanName = name.trim(), cleanCode = code.trim();
  if (!cleanName || buyPrice < 0 || sellPrice < 0) return alert("Data barang tidak valid.");
  if (state.products.some((p) => p.id !== id && cleanCode && String(p.code || "").trim() === cleanCode)) return alert("Barcode tersebut sudah dipakai barang lain.");
  const changes = { name: cleanName, code: cleanCode, category, buyPrice, sellPrice, updatedAt: serverTimestamp() };
  try { if (!String(id).startsWith("local-")) await updateDoc(doc(db, "products", id), changes); }
  catch (err) { console.warn("Update Firebase gagal, perubahan tetap disimpan lokal:", err); }
  Object.assign(product, { ...changes, updatedAt: new Date() });
  window.tutupModalRoot();
  toast(`${cleanName} berhasil diperbarui!`); render();
};

// ========================================================
// 3. HALAMAN STOK BARANG - MOBILE TUNED
// ========================================================
function renderStokBarang() {
  const totalItems = state.products.length;
  const safeItems = state.products.filter(
    (p) => !isLowStock(p) && !isEmptyStock(p),
  ).length;
  const warningItems = state.products.filter(
    (p) => isLowStock(p) || isEmptyStock(p),
  ).length;

  const filtered = state.products.filter((p) => {
    const textMatch =
      !state.stockSearch ||
      `${p.name} ${p.code || ""}`
        .toLowerCase()
        .includes(state.stockSearch.toLowerCase());
    if (!textMatch) return false;

    if (state.stockFilter === "warning") return isLowStock(p);
    if (state.stockFilter === "empty") return isEmptyStock(p);
    return true;
  });

  const stockRows = filtered.length
    ? filtered
        .map((p) => {
          const stock = totalStock(p);
          const empty = isEmptyStock(p);
          const warn = isLowStock(p);

          let badgeHtml = `<span class="px-1.5 py-0.5 rounded bg-green-badge-bg text-green-badge-text text-[10px] font-semibold shrink-0">Aman</span>`;
          if (empty) {
            badgeHtml = `<span class="px-1.5 py-0.5 rounded bg-danger-solid text-on-error text-[10px] font-bold shrink-0">Habis</span>`;
          } else if (warn) {
            badgeHtml = `<span class="px-1.5 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed text-[10px] font-bold shrink-0">Menipis</span>`;
          }

          return `
      <article class="stock-item bg-surface-container-lowest border border-border-warm-subtle rounded-xl p-2.5 shadow-xs flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5">
          ${badgeHtml}
          <h2 class="text-[13px] font-semibold text-on-surface truncate flex-1">${esc(p.name)}</h2>
        </div>
        <div class="flex items-center justify-between gap-1 pt-1 border-t border-border-warm-subtle">
          <div class="flex items-center gap-1.5 text-text-muted-ink min-w-0">
            <span class="text-[12.5px] font-bold text-on-surface">${money(p.sellPrice)}</span>
            <span>•</span>
            <span class="text-[11.5px] ${empty ? "text-danger-solid" : warn ? "text-tertiary font-bold" : "text-on-surface"} font-semibold">
              Sisa: <span class="font-bold">${stock}</span> ${esc(p.baseUnit || "pcs")}
            </span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button aria-label="Kurangi Stok" title="Kurangi Stok" class="w-6.5 h-6.5 rounded-lg bg-surface-sand hover:bg-surface-container text-on-surface border border-border-warm-subtle font-medium flex items-center justify-center active:translate-y-0.5 transition-all cursor-pointer" onclick="window.bukaModalKurangiStok('${p.id}')">
              <span class="material-symbols-outlined text-[15px]">remove</span>
            </button>
            <button title="Tambah Stok" class="h-6.5 px-2 rounded-lg bg-primary text-on-primary text-[11px] font-semibold flex items-center justify-center gap-0.5 active:translate-y-0.5 transition-all cursor-pointer" onclick="window.bukaModalRestock('${p.id}')">
              <span class="material-symbols-outlined text-[14px]">add</span>
              <span>Tambah</span>
            </button>
            <button aria-label="Edit Barang" title="Edit Barang" class="w-6.5 h-6.5 rounded-lg bg-surface-sand hover:bg-surface-container text-primary border border-border-warm-subtle flex items-center justify-center active:translate-y-0.5 transition-all cursor-pointer" onclick="window.editBarang('${p.id}')">
              <span class="material-symbols-outlined text-[15px]">edit</span>
            </button>
            <button aria-label="Hapus Barang" title="Hapus Barang Dari Toko" class="w-6.5 h-6.5 rounded-lg bg-surface-sand hover:bg-danger-soft-bg text-outline hover:text-danger-solid border border-border-warm-subtle flex items-center justify-center active:translate-y-0.5 transition-all cursor-pointer" onclick="window.konfirmasiHapusBarang('${p.id}')">
              <span class="material-symbols-outlined text-[15px]">delete</span>
            </button>
          </div>
        </div>
      </article>`;
        })
        .join("")
    : state.products.length === 0
      ? `
      <div class="col-span-full py-12 px-4 text-center flex flex-col items-center justify-center gap-3 bg-surface-container-lowest border border-dashed border-border-warm rounded-2xl shadow-xs">
        <div class="w-12 h-12 rounded-full bg-surface-sand flex items-center justify-center text-primary">
          <span class="material-symbols-outlined text-[26px]">inventory_2</span>
        </div>
        <div class="flex flex-col gap-1 max-w-sm">
          <h4 class="text-[14.5px] font-bold text-on-surface">Belum Ada Stok Barang</h4>
          <p class="text-[12px] text-text-muted-ink">Persediaan barang warung masih kosong. Klik tombol di bawah untuk mendaftarkan barang dagangan.</p>
        </div>
        <button type="button" onclick="window.pindahHalaman('tambah-barang')" class="h-11 px-5 rounded-xl bg-primary text-on-primary text-[13px] font-bold flex items-center gap-1.5 shadow-xs hover:opacity-95 transition-all cursor-pointer active:scale-95">
          <span class="material-symbols-outlined text-[18px]">add_circle</span>
          <span>Tambah Barang Baru</span>
        </button>
      </div>`
      : `<div class="col-span-full py-8 text-center text-text-muted-ink text-[12.5px] bg-surface-container-lowest rounded-xl border border-border-warm-subtle">Tidak ada persediaan barang yang cocok.</div>`;

  return `
  <div class="flex flex-col w-full gap-2.5">
    <!-- Ringkasan Cepat Persediaan (Responsif di Layar Komputer) -->
    <section class="grid grid-cols-3 gap-1.5 md:gap-3">
      <div class="flex flex-col p-2 md:p-3 bg-surface-sand border border-border-warm-subtle rounded-xl shadow-xs">
        <div class="flex items-center justify-between text-text-muted-ink">
          <span class="text-[11px] md:text-[12px] font-semibold">Total</span>
          <span class="material-symbols-outlined text-[15px] md:text-[18px]">inventory_2</span>
        </div>
        <span class="text-[17px] md:text-[22px] text-on-surface font-bold mt-0.5">${totalItems}</span>
      </div>
      <div class="flex flex-col p-2 md:p-3 bg-green-badge-bg border border-green-fresh-vibrant/20 rounded-xl shadow-xs">
        <div class="flex items-center justify-between text-green-badge-text">
          <span class="text-[11px] md:text-[12px] font-semibold">Aman</span>
          <span class="material-symbols-outlined text-[15px] md:text-[18px]">check_circle</span>
        </div>
        <span class="text-[17px] md:text-[22px] text-primary font-bold mt-0.5">${safeItems}</span>
      </div>
      <div class="flex flex-col p-2 md:p-3 bg-danger-soft-bg border border-danger-solid/20 rounded-xl shadow-xs">
        <div class="flex items-center justify-between text-danger-solid">
          <span class="text-[11px] md:text-[12px] font-semibold">Menipis</span>
          <span class="material-symbols-outlined text-[15px] md:text-[18px]">warning</span>
        </div>
        <span class="text-[17px] md:text-[22px] text-danger-solid font-bold mt-0.5">${warningItems}</span>
      </div>
    </section>

    <!-- Bar Pencarian Cepat & Filter Responsif (Side-by-side di Layar Komputer) -->
    <section class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
      <div class="relative w-full md:max-w-md">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted-ink">
          <span class="material-symbols-outlined text-[19px]">search</span>
        </div>
        <input class="w-full h-10.5 pl-9 pr-3 bg-surface-container-lowest border border-border-warm-subtle text-on-surface rounded-xl shadow-xs text-[13.5px] focus:outline-none focus:border-primary placeholder:text-text-muted-ink/60" id="stock-search-input" placeholder="Cari beras, minyak, telur..." type="text" value="${esc(state.stockSearch)}" oninput="window.handleStockSearch(this.value)">
      </div>

      <!-- Filter Pil Kategori Sederhana -->
      <div class="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar shrink-0">
        <button class="px-3 py-1.5 rounded-full text-[11.5px] shadow-xs shrink-0 transition-all flex items-center gap-1 cursor-pointer ${
          state.stockFilter === "all"
            ? "bg-primary text-on-primary font-bold"
            : "bg-surface-sand text-text-muted-ink border border-border-warm-subtle font-medium"
        }" onclick="window.setStockFilter('all')">
          <span class="material-symbols-outlined text-[15px]">apps</span>
          Semua (${totalItems})
        </button>
        <button class="px-3 py-1.5 rounded-full text-[11.5px] shadow-xs shrink-0 transition-all flex items-center gap-1 cursor-pointer ${
          state.stockFilter === "warning"
            ? "bg-tertiary-fixed text-on-tertiary-fixed font-bold border border-tertiary-fixed-dim/40"
            : "bg-surface-sand text-text-muted-ink border border-border-warm-subtle font-medium"
        }" onclick="window.setStockFilter('warning')">
          <span class="material-symbols-outlined text-[15px]">priority_high</span>
          Menipis (${warningItems})
        </button>
        <button class="px-3 py-1.5 rounded-full text-[11.5px] shadow-xs shrink-0 transition-all flex items-center gap-1 cursor-pointer ${
          state.stockFilter === "empty"
            ? "bg-danger-solid text-on-error font-bold"
            : "bg-surface-sand text-text-muted-ink border border-border-warm-subtle font-medium"
        }" onclick="window.setStockFilter('empty')">
          <span class="material-symbols-outlined text-[15px]">report</span>
          Habis (${state.products.filter(isEmptyStock).length})
        </button>
      </div>
    </section>

    <!-- Banner Pengingat Kulakan -->
    <div class="py-2 px-3 bg-tertiary-fixed/30 border border-tertiary-fixed-dim/40 rounded-xl flex items-center justify-between">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="material-symbols-outlined text-[17px] text-tertiary shrink-0">local_shipping</span>
        <span class="text-[12px] text-on-tertiary-fixed font-semibold truncate">Kulakan Pasar: Besok Subuh</span>
      </div>
      <span class="text-[11px] font-bold px-2 py-0.5 bg-tertiary-fixed text-on-tertiary-fixed rounded-full shrink-0">${warningItems} barang</span>
    </div>

    <!-- Daftar Kartu Barang Persediaan (Responsif: 1 kolom di HP, 2 di Tablet, 3 di Komputer) -->
    <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
      ${stockRows}
    </section>
  </div>`;
}

// Stok Handlers
window.handleStockSearch = (v) => {
  state.stockSearch = v;
  const input = $("#stock-search-input");
  const pos = input ? input.selectionStart : null;
  render();
  const newInput = $("#stock-search-input");
  if (newInput && pos !== null) {
    newInput.focus();
    newInput.setSelectionRange(pos, pos);
  }
};

window.setStockFilter = (f) => {
  state.stockFilter = f;
  render();
};

window.bukaModalKurangiStok = (id) => {
  const p = state.products.find((prod) => prod.id === id);
  if (!p) return;
  state.restockTarget = p;
  const modalRoot = $("#modal-root");
  if (!modalRoot) return;
  modalRoot.innerHTML = `
  <div class="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" id="restock-modal">
    <div class="w-full sm:max-w-md bg-surface-container-lowest border border-border-warm-subtle rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3 shadow-2xl">
      <div class="flex items-center justify-between">
        <div class="min-w-0">
          <span class="text-[11.5px] text-tertiary font-bold">Kurangi Stok</span>
          <h3 class="text-[15px] font-bold text-on-surface truncate">${esc(p.name)}</h3>
        </div>
        <button class="w-8 h-8 rounded-full bg-surface-sand flex items-center justify-center text-text-muted-ink border border-border-warm-subtle" onclick="window.tutupModalRestock()">
          <span class="material-symbols-outlined text-[19px]">close</span>
        </button>
      </div>
      <div class="p-2.5 bg-surface-sand rounded-xl border border-border-warm-subtle flex flex-col gap-1">
        <span class="text-[12px] text-text-muted-ink font-medium">Pilih jumlah stok yang dikurangi (tersedia: ${totalStock(p)}):</span>
        <div class="grid grid-cols-3 gap-1.5 mt-0.5">
          <button class="h-11 bg-surface-container-lowest border border-border-warm-subtle rounded-lg text-[16px] text-tertiary font-bold shadow-xs" onclick="window.eksekusiKurangiStok(1)">−1</button>
          <button class="h-11 bg-surface-container-lowest border border-border-warm-subtle rounded-lg text-[16px] text-tertiary font-bold shadow-xs" onclick="window.eksekusiKurangiStok(5)">−5</button>
          <button class="h-11 bg-surface-container-lowest border border-border-warm-subtle rounded-lg text-[16px] text-tertiary font-bold shadow-xs" onclick="window.eksekusiKurangiStok(10)">−10</button>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-[12px] text-on-surface font-semibold" for="custom-qty-input">Atau isi jumlah lainnya:</label>
        <div class="flex items-center gap-1.5">
          <input class="h-11 flex-1 px-3 bg-surface-sand border border-border-warm-subtle rounded-lg text-[18px] text-on-surface font-extrabold focus:outline-none focus:border-primary" id="custom-qty-input" min="1" max="${totalStock(p)}" type="number" value="1">
          <span class="text-[13px] text-text-muted-ink font-semibold">${esc(p.baseUnit || "pcs")}</span>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 mt-1">
        <button class="h-11.5 rounded-xl bg-surface-sand hover:bg-surface-container-warm border border-border-warm-subtle text-on-surface text-[13.5px] font-semibold transition-all cursor-pointer shadow-xs active:scale-[0.98]" onclick="window.tutupModalRestock()">Batal</button>
        <button class="h-11.5 rounded-xl bg-primary hover:opacity-95 text-on-primary text-[13.5px] font-bold flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer active:scale-[0.98]" onclick="window.eksekusiKurangiStokCustom()"><span class="material-symbols-outlined text-[17px]">save</span>Simpan</button>
      </div>
    </div>
  </div>`;
};

window.kurangiStokCepat = async (id, qty = 1) => {
  const p = state.products.find((prod) => prod.id === id);
  if (!p || !Number.isSafeInteger(qty) || qty <= 0) return;
  try {
    if (id.startsWith("local-") || id.startsWith("demo-")) {
      throw new Error("Barang ini hanya tersimpan lokal. Hubungkan Firebase lalu muat ulang.");
    }
    await runTransaction(db, async (tx) => {
      const productRef = doc(db, "products", id);
      const snapshot = await tx.get(productRef);
      if (!snapshot.exists()) throw new Error("Barang tidak ditemukan di Firebase.");

      const current = snapshot.data();
      const display = num(current.display);
      const warehouse = num(current.warehouse);
      if (display + warehouse < qty) throw new Error(`Stok tidak cukup. Tersedia ${display + warehouse}.`);
      const fromDisplay = Math.min(display, qty);

      tx.update(productRef, {
        display: display - fromDisplay,
        warehouse: warehouse - (qty - fromDisplay),
        updatedAt: serverTimestamp(),
      });
      tx.set(doc(collection(db, "stockMovements")), {
        productId: id,
        productName: p.name,
        type: "Pengurangan Stok",
        quantity: -qty,
        unit: p.baseUnit || "pcs",
        createdAt: serverTimestamp(),
      });
    });
    const fromDisplay = Math.min(num(p.display), qty);
    p.display = num(p.display) - fromDisplay;
    p.warehouse = Math.max(0, num(p.warehouse) - (qty - fromDisplay));
  } catch (err) {
    toast(`Gagal mengurangi stok: ${err.message}`, "error");
    return;
  }
  toast(`${p.name} dikurangi ${qty} (sisa: ${totalStock(p)})`);
  render();
};

window.eksekusiKurangiStok = async (qty) => {
  const p = state.restockTarget;
  if (!p) return;
  await window.kurangiStokCepat(p.id, qty);
  if (totalStock(p) < num($("#custom-qty-input")?.max)) {
    window.tutupModalRestock();
  }
};

window.eksekusiKurangiStokCustom = async () => {
  const qty = parseInt($("#custom-qty-input")?.value, 10) || 0;
  if (qty > 0) await window.eksekusiKurangiStok(qty);
};

window.bukaModalRestock = (id) => {
  const p = state.products.find((prod) => prod.id === id);
  if (!p) return;
  state.restockTarget = p;
  const modalRoot = $("#modal-root");
  if (!modalRoot) return;

  modalRoot.innerHTML = `
  <div class="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" id="restock-modal">
    <div class="w-full sm:max-w-md bg-surface-container-lowest border border-border-warm-subtle rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3 shadow-2xl">
      <div class="flex items-center justify-between">
        <div class="min-w-0">
          <span class="text-[11.5px] text-primary font-bold">Kulakan Barang Masuk</span>
          <h3 class="text-[15px] font-bold text-on-surface truncate">${esc(p.name)}</h3>
        </div>
        <button class="w-8 h-8 rounded-full bg-surface-sand flex items-center justify-center text-text-muted-ink border border-border-warm-subtle" onclick="window.tutupModalRestock()">
          <span class="material-symbols-outlined text-[19px]">close</span>
        </button>
      </div>

      <div class="p-2.5 bg-surface-sand rounded-xl border border-border-warm-subtle flex flex-col gap-1">
        <span class="text-[12px] text-text-muted-ink font-medium">Pilih jumlah kulakan masuk:</span>
        <div class="grid grid-cols-3 gap-1.5 mt-0.5">
          <button class="h-11 bg-surface-container-lowest border border-border-warm-subtle rounded-lg text-[16px] text-primary font-bold shadow-xs active:bg-primary active:text-on-primary transition-colors flex items-center justify-center" onclick="window.eksekusiRestock(10)">
            +10
          </button>
          <button class="h-11 bg-surface-container-lowest border border-border-warm-subtle rounded-lg text-[16px] text-primary font-bold shadow-xs active:bg-primary active:text-on-primary transition-colors flex items-center justify-center" onclick="window.eksekusiRestock(20)">
            +20
          </button>
          <button class="h-11 bg-surface-container-lowest border border-border-warm-subtle rounded-lg text-[16px] text-primary font-bold shadow-xs active:bg-primary active:text-on-primary transition-colors flex items-center justify-center" onclick="window.eksekusiRestock(50)">
            +50
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-[12px] text-on-surface font-semibold" for="custom-qty-input">Atau isi jumlah lainnya:</label>
        <div class="flex items-center gap-1.5">
          <input class="h-11 flex-1 px-3 bg-surface-sand border border-border-warm-subtle rounded-lg text-[18px] text-on-surface font-extrabold focus:outline-none focus:border-primary" id="custom-qty-input" min="1" type="number" value="10">
          <span class="text-[13px] text-text-muted-ink font-semibold">${esc(p.baseUnit || "pcs")}</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 mt-1">
        <button class="h-11.5 rounded-xl bg-surface-sand hover:bg-surface-container-warm border border-border-warm-subtle text-on-surface text-[13.5px] font-semibold transition-all cursor-pointer shadow-xs active:scale-[0.98]" onclick="window.tutupModalRestock()">
          Batal
        </button>
        <button class="h-11.5 rounded-xl bg-primary hover:opacity-95 text-on-primary text-[13.5px] font-bold flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer active:scale-[0.98]" onclick="window.eksekusiRestockCustom()">
          <span class="material-symbols-outlined text-[17px]">save</span>
          Simpan Stok
        </button>
      </div>
    </div>
  </div>`;
};

window.tutupModalRestock = () => {
  const modalRoot = $("#modal-root");
  if (modalRoot) modalRoot.innerHTML = "";
  state.restockTarget = null;
};

window.eksekusiRestock = async (qty) => {
  const p = state.restockTarget;
  if (!p || !Number.isFinite(qty) || qty <= 0) return;
  try {
    if (p.id.startsWith("local-") || p.id.startsWith("demo-")) {
      throw new Error("Barang ini hanya tersimpan lokal. Hubungkan Firebase lalu muat ulang.");
    }
    await runTransaction(db, async (tx) => {
      const productRef = doc(db, "products", p.id);
      const movementRef = doc(collection(db, "stockMovements"));
      const snapshot = await tx.get(productRef);
      if (!snapshot.exists()) throw new Error("Barang tidak ditemukan di Firebase.");

      const current = snapshot.data();
      tx.update(productRef, {
        display: num(current.display) + qty,
        updatedAt: serverTimestamp(),
      });
      tx.set(movementRef, {
        productId: p.id,
        productName: p.name,
        type: "Kulakan Masuk",
        quantity: qty,
        unit: p.baseUnit || "pcs",
        createdAt: serverTimestamp(),
      });
    });
    p.display = num(p.display) + qty;
  } catch (err) {
    toast(`Gagal menambah stok: ${err.message}`, "error");
    return;
  }
  toast(`Stok ${p.name} bertambah +${qty}!`);
  window.tutupModalRestock();
  render();
};

window.eksekusiRestockCustom = () => {
  const input = $("#custom-qty-input");
  const val = parseInt(input?.value, 10) || 0;
  if (val > 0) window.eksekusiRestock(val);
};

// ========================================================
// 4. HALAMAN KEUANGAN & LAPORAN - MOBILE TUNED
// ========================================================
function renderKeuangan() {
  const { transactions: transList, expenses: expenseList } = activeReportData();
  const allPeriodTransactions = state.transactions.filter((t) => isInActivePeriod(t.createdAt));

  const uangMasuk = transList.reduce((acc, t) => acc + num(t.total), 0);
  const totalModal = transList.reduce((acc, t) => acc + num(t.costTotal), 0);
  const totalPengeluaran = expenseList.reduce(
    (acc, e) => acc + num(e.amount),
    0,
  );
  const labaBersih = uangMasuk - totalModal;
  const pembeliCount = transList.length;
  const barangTerjual = transList.reduce(
    (acc, t) => acc + (t.items || []).reduce((x, i) => x + i.qty, 0),
    0,
  );

  let statusPeriodeText = "Hari Ini (" + getTodayDateString() + ")";
  let badgeDurasi = "1 Hari";

  if (state.periodMode === "custom") {
    if (state.customSubmode === "single") {
      statusPeriodeText = `Tanggal ${state.singleDate}`;
      badgeDurasi = "1 Hari";
    } else if (state.customSubmode === "range") {
      statusPeriodeText = `${state.rangeStart} s/d ${state.rangeEnd}`;
      badgeDurasi = "Rentang";
    } else {
      statusPeriodeText = `Bulan ${monthOptions().find((month) => month.value === state.filterMonth)?.label || state.filterMonth}`;
      badgeDurasi = "1 Bulan";
    }
  }

  return `
  <div class="flex flex-col w-full gap-2.5">
    <!-- Tab Periode Cepat: 2 Pilihan Bersih -->
    <div class="grid grid-cols-2 gap-1 p-1 bg-surface-sand border border-border-warm-subtle rounded-xl">
      <button class="py-2 px-2 rounded-lg text-[13.5px] font-bold shadow-xs transition-all text-center flex items-center justify-center gap-1.5 ${
        state.periodMode === "today"
          ? "bg-surface-container-lowest text-primary border border-border-warm-subtle/50"
          : "text-text-muted-ink hover:text-text-primary-ink"
      }" id="tab-btn-today" onclick="window.pilihHariIni()" type="button">
        <span class="material-symbols-outlined text-[17px]">today</span>
        <span>Hari Ini</span>
      </button>
      <button class="py-2 px-2 rounded-lg text-[13.5px] font-bold transition-all text-center flex items-center justify-center gap-1.5 ${
        state.periodMode === "custom"
          ? "bg-surface-container-lowest text-primary border border-border-warm-subtle/50 shadow-xs"
          : "text-text-muted-ink hover:text-text-primary-ink"
      }" id="tab-btn-kustom" onclick="window.bukaModalKustom()" type="button">
        <span class="material-symbols-outlined text-[17px]">tune</span>
        <span>Kustom Periode</span>
      </button>
    </div>

    <!-- Indikator Status Periode Aktif -->
    <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-sand/80 border border-border-warm-subtle/70">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="material-symbols-outlined text-primary text-[16px] shrink-0">event_available</span>
        <span class="text-[12px] text-text-primary-ink truncate">Data: <span class="font-bold text-primary">${statusPeriodeText}</span></span>
      </div>
      <button class="px-2 py-0.5 rounded-full bg-green-badge-bg hover:opacity-90 text-green-badge-text text-[11px] font-bold shrink-0 flex items-center gap-0.5" onclick="window.bukaModalKustom()" type="button">
        <span>${badgeDurasi}</span>
        <span class="material-symbols-outlined text-[13px]">expand_more</span>
      </button>
    </div>

    <!-- 3 Kartu Ringkasan Angka Besar (Responsif 3 Kolom di Layar Komputer) -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3">
      <div class="p-2.5 md:p-3 rounded-xl bg-surface-container-lowest border border-border-warm-subtle shadow-xs flex items-center justify-between">
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-1 text-primary text-[12px] font-semibold">
            <span class="material-symbols-outlined text-[17px]">arrow_downward_alt</span>
            <span>Uang Masuk (Omzet)</span>
          </div>
          <span class="text-[16.5px] md:text-[19px] text-primary font-bold mt-0.5">${money(uangMasuk)}</span>
        </div>
        <span class="px-2 py-0.5 rounded-full bg-green-badge-bg text-green-badge-text text-[11px] font-bold shrink-0">${pembeliCount} Pembeli</span>
      </div>

      <div class="p-2.5 md:p-3 rounded-xl bg-surface-sand border border-border-warm-subtle shadow-xs flex items-center justify-between">
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-1 text-text-primary-ink text-[12px] font-semibold">
            <span class="material-symbols-outlined text-[17px]">inventory</span>
            <span>Modal (HPP)</span>
          </div>
          <span class="text-[16.5px] md:text-[19px] text-text-primary-ink font-bold mt-0.5">${money(totalModal)}</span>
        </div>
        <span class="px-2 py-0.5 rounded-full bg-surface-container-high text-text-muted-ink text-[11px] font-semibold shrink-0">Kulakan</span>
      </div>

      <div class="p-2.5 md:p-3 rounded-xl bg-tertiary-fixed border border-secondary-fixed shadow-xs flex items-center justify-between">
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-1 text-on-tertiary-fixed text-[12px] font-semibold">
            <span class="material-symbols-outlined text-[17px] text-tertiary-container" style="font-variation-settings: 'FILL' 1;">savings</span>
            <span class="truncate">Keuntungan Barang</span>
          </div>
          <span class="text-[16.5px] md:text-[19px] text-tertiary-container font-bold mt-0.5">${money(labaBersih)}</span>
        </div>
        <span class="px-2 py-0.5 rounded-full bg-tertiary-container text-on-tertiary text-[11px] font-bold shrink-0">Laba</span>
      </div>
    </div>

    <!-- Tata Letak 2 Kolom Responsif di Komputer (Kiri: Pengeluaran & Aksi, Kanan: Riwayat Transaksi) -->
    <div class="keuangan-desktop-wrapper w-full">
      <div class="lg:grid lg:grid-cols-12 lg:gap-5 items-start">
        <!-- KOLOM KIRI (5/12): Catat Pengeluaran, Ringkasan Operasional & Aksi -->
        <div class="keuangan-left-col lg:col-span-5 flex flex-col gap-2.5">
          <!-- Catat Pengeluaran Toko Sederhana -->
          <div class="p-3 rounded-xl bg-surface-container-lowest border border-border-warm-subtle shadow-xs flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1">
                <span class="material-symbols-outlined text-tertiary-container text-[20px]">receipt_long</span>
                <h2 class="text-[13.5px] text-text-primary-ink font-bold">Catat Pengeluaran</h2>
              </div>
            </div>
            <form class="flex flex-col gap-1.5" onsubmit="event.preventDefault(); window.simpanBiaya();">
              <div class="flex gap-1.5">
                <input class="flex-1 h-10 px-2.5 rounded-lg bg-surface-sand text-text-primary-ink border border-border-warm text-[13px] placeholder:text-text-muted-ink outline-none focus:border-tertiary-container focus:bg-surface-cream transition-colors min-w-0" id="nama-pengeluaran" placeholder="Keperluan (misal: Kresek)" required type="text">
                <div class="relative flex items-center w-32 shrink-0">
                  <span class="absolute left-2 text-[12px] font-semibold text-text-muted-ink select-none">Rp</span>
                  <input class="w-full h-10 pl-7 pr-2 rounded-lg bg-surface-sand text-text-primary-ink border border-border-warm text-[13px] font-bold placeholder:text-text-muted-ink outline-none focus:border-tertiary-container focus:bg-surface-cream transition-colors" id="nominal-pengeluaran" placeholder="0" required type="text" inputmode="numeric" data-money-input oninput="window.formatNominalInput(this)">
                </div>
              </div>
              <button class="h-9 rounded-lg bg-tertiary-container hover:opacity-95 text-on-tertiary text-[12.5px] font-bold flex items-center justify-center gap-1 shadow-xs active:translate-y-0.5 transition-all cursor-pointer" type="submit">
                <span class="material-symbols-outlined text-[17px]">add_circle</span>
                <span>Simpan Pengeluaran</span>
              </button>
            </form>
          </div>

          <!-- Ringkasan Transaksi & Barang Terjual -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between px-0.5">
              <div class="flex items-center gap-1">
                <span class="material-symbols-outlined text-primary text-[19px]">summarize</span>
                <h3 class="text-[13.5px] text-text-primary-ink font-bold">Ringkasan Operasional</h3>
              </div>
            </div>
            <div class="p-2.5 rounded-xl bg-surface-container-lowest border border-border-warm-subtle shadow-xs grid grid-cols-2 gap-2">
              <div class="flex flex-col min-w-0 p-2 rounded-lg bg-surface-sand/80 border border-border-warm-subtle/50">
                <span class="text-[11.5px] text-text-muted-ink font-medium">Total Transaksi</span>
                <span class="text-[18px] text-text-primary-ink font-bold mt-0.5">${pembeliCount}</span>
              </div>
              <div class="flex flex-col min-w-0 p-2 rounded-lg bg-surface-sand/80 border border-border-warm-subtle/50">
                <span class="text-[11.5px] text-text-muted-ink font-medium">Barang Terjual</span>
                <span class="text-[18px] text-primary font-bold mt-0.5">${barangTerjual}</span>
              </div>
            </div>
          </div>

          <!-- Tombol Aksi Cepat Laporan -->
          <div class="flex flex-col gap-2 pt-0.5">
            <button class="h-12 md:h-12.5 rounded-xl bg-green-badge-bg border border-green-fresh-vibrant/35 text-green-badge-text text-[13.5px] font-bold flex items-center justify-center gap-2 shadow-xs active:scale-[0.99] transition-all hover:bg-green-fresh-vibrant/20 cursor-pointer" onclick="window.exportExcel()" type="button">
              <span class="material-symbols-outlined text-green-fresh-vibrant text-[20px]">table_view</span>
              <span>Export ke Excel (.xlsx / .csv)</span>
            </button>
            <div class="grid grid-cols-2 gap-2">
              <button class="h-11 md:h-11.5 rounded-xl bg-primary hover:opacity-95 text-on-primary text-[13px] font-bold flex items-center justify-center gap-1.5 shadow-xs active:scale-[0.99] transition-all cursor-pointer" onclick="window.cetakLaporanKeuangan()" type="button">
                <span class="material-symbols-outlined text-[18px]">print</span>
                <span>Cetak Laporan</span>
              </button>
              <button class="h-11 md:h-11.5 rounded-xl bg-surface-sand border border-border-warm text-text-primary-ink hover:bg-surface-container-warm text-[13px] font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer" onclick="window.bagikanWALaporan()" type="button">
                <span class="material-symbols-outlined text-primary text-[18px]" style="font-variation-settings: 'FILL' 1;">send</span>
                <span>Kirim WA</span>
              </button>
            </div>
          </div>
        </div>

        <!-- KOLOM KANAN (7/12): Riwayat Transaksi -->
        <div class="keuangan-right-col lg:col-span-7 flex flex-col gap-2 mt-2.5 lg:mt-0">
          <div class="flex items-center justify-between px-0.5">
            <h3 class="text-[13.5px] text-text-primary-ink font-bold">Riwayat Transaksi Terakhir</h3>
            <span class="text-[11.5px] text-text-muted-ink">${allPeriodTransactions.length} transaksi</span>
          </div>
          <div class="flex flex-col gap-1.5 max-h-[520px] overflow-y-auto no-scrollbar">
            ${
              allPeriodTransactions.length
                ? allPeriodTransactions
                    .slice(0, 15)
                    .map((t) => {
                      const isBatal = t.status === "dibatalkan";
                      return `
              <div class="trans-item p-2.5 ${isBatal ? "bg-surface-sand/80 opacity-75" : "bg-surface-container-lowest"} border border-border-warm-subtle rounded-xl flex items-center justify-between shadow-xs hover:border-primary/50 transition-colors cursor-pointer" onclick="window.bukaNotaModal(${JSON.stringify(t).replace(/"/g, "&quot;")})">
                <div class="flex flex-col min-w-0 pr-2">
                  <div class="flex items-center gap-1.5">
                    <span class="font-bold text-[12.5px] ${isBatal ? "text-text-muted-ink line-through" : "text-text-primary-ink"}">${esc(t.number)}</span>
                    ${isBatal ? `<span class="px-1.5 py-0.2 rounded bg-danger-soft-bg text-danger-solid text-[9.5px] font-bold">Dibatalkan</span>` : ""}
                  </div>
                  <span class="text-[11px] text-text-muted-ink">${dateFmt(t.createdAt)} · ${(t.items || []).length} item</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <span class="font-extrabold text-[13px] ${isBatal ? "text-text-muted-ink line-through" : "text-primary"}">${money(t.total)}</span>
                  <span class="material-symbols-outlined text-text-muted-ink text-[16px]">chevron_right</span>
                </div>
              </div>`;
                    })
                    .join("")
                : `<div class="py-8 text-center text-text-muted-ink text-[12.5px]">Belum ada transaksi pada periode ini.</div>`
            }
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// Keuangan Handlers
window.pilihHariIni = () => {
  state.periodMode = "today";
  render();
};

window.bukaModalKustom = () => {
  const modalRoot = $("#modal-root");
  if (!modalRoot) return;

  modalRoot.innerHTML = `
  <div class="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-sm flex flex-col justify-end p-margin-mobile" id="modal-periode-kustom">
    <div class="bg-surface-cream rounded-2xl p-4 flex flex-col gap-3 border border-border-warm shadow-2xl max-w-lg mx-auto w-full max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-border-warm-subtle/60 pb-1">
        <div class="flex items-center gap-1.5">
          <div class="w-8 h-8 rounded-full bg-surface-sand flex items-center justify-center text-primary">
            <span class="material-symbols-outlined text-[19px]">calendar_month</span>
          </div>
          <div>
            <h3 class="text-[14.5px] font-bold text-text-primary-ink leading-tight">Pilih Periode</h3>
            <p class="text-[11.5px] text-text-muted-ink">Rentang data laporan keuangan</p>
          </div>
        </div>
        <button class="w-8 h-8 rounded-full bg-surface-sand border border-border-warm flex items-center justify-center text-text-primary-ink" onclick="window.tutupModalKustom()">
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <div class="grid grid-cols-3 gap-1 p-1 bg-surface-sand border border-border-warm-subtle rounded-xl text-center">
        <button class="py-1.5 px-1 rounded-lg text-[12.5px] font-bold shadow-xs transition-all ${
          state.customSubmode === "single"
            ? "bg-surface-container-lowest text-primary"
            : "text-text-muted-ink"
        }" id="subtab-single" onclick="window.gantiSubtabKustom('single')">Per Tanggal</button>
        <button class="py-1.5 px-1 rounded-lg text-[12.5px] font-bold transition-all ${
          state.customSubmode === "range"
            ? "bg-surface-container-lowest text-primary shadow-xs"
            : "text-text-muted-ink"
        }" id="subtab-range" onclick="window.gantiSubtabKustom('range')">Rentang</button>
        <button class="py-1.5 px-1 rounded-lg text-[12.5px] font-bold transition-all ${
          state.customSubmode === "month"
            ? "bg-surface-container-lowest text-primary shadow-xs"
            : "text-text-muted-ink"
        }" id="subtab-month" onclick="window.gantiSubtabKustom('month')">Per Bulan</button>
      </div>

      <div class="flex flex-col gap-1 ${state.customSubmode === "single" ? "flex" : "hidden"}" id="form-mode-single">
        <label class="text-[12.5px] font-semibold text-text-primary-ink flex items-center gap-1" for="input-single-date">
          <span class="material-symbols-outlined text-primary text-[16px]">event</span> Tanggal Spesifik:
        </label>
        <input class="h-10 px-3 rounded-lg bg-surface-sand text-text-primary-ink border border-border-warm text-[13px] outline-none focus:border-primary focus:bg-surface-cream" id="input-single-date" type="date" value="${state.singleDate}">
      </div>

      <div class="flex-col gap-1 ${state.customSubmode === "range" ? "flex" : "hidden"}" id="form-mode-range">
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-0.5">
            <label class="text-[11.5px] text-text-muted-ink font-semibold" for="input-range-mulai">Mulai:</label>
            <input class="h-10 px-2 rounded-lg bg-surface-sand text-text-primary-ink border border-border-warm text-[12.5px] outline-none focus:border-primary focus:bg-surface-cream" id="input-range-mulai" type="date" value="${state.rangeStart}">
          </div>
          <div class="flex flex-col gap-0.5">
            <label class="text-[11.5px] text-text-muted-ink font-semibold" for="input-range-sampai">Sampai:</label>
            <input class="h-10 px-2 rounded-lg bg-surface-sand text-text-primary-ink border border-border-warm text-[12.5px] outline-none focus:border-primary focus:bg-surface-cream" id="input-range-sampai" type="date" value="${state.rangeEnd}">
          </div>
        </div>
      </div>

      <div class="flex-col gap-1 ${state.customSubmode === "month" ? "flex" : "hidden"}" id="form-mode-month">
        <label class="text-[12.5px] font-semibold text-text-primary-ink" for="select-filter-bulan">Pilih Bulan & Tahun:</label>
        <select class="h-10 px-3 rounded-lg bg-surface-sand text-text-primary-ink border border-border-warm text-[13px] outline-none focus:border-primary focus:bg-surface-cream" id="select-filter-bulan">
          ${monthOptions().map((month) => `<option value="${month.value}" ${month.value === state.filterMonth ? "selected" : ""}>${esc(month.label)}</option>`).join("")}
        </select>
      </div>

      <div class="flex gap-2.5 pt-2.5 border-t border-border-warm-subtle/70">
        <button class="flex-1 h-12 rounded-xl bg-surface-sand hover:bg-surface-container-warm border border-border-warm text-text-primary-ink text-[13.5px] font-semibold transition-all cursor-pointer shadow-xs active:scale-[0.98]" onclick="window.tutupModalKustom()">Batal</button>
        <button class="flex-[2] h-12 rounded-xl bg-primary hover:opacity-95 text-on-primary text-[14px] font-bold flex items-center justify-center gap-1.5 shadow-xs active:translate-y-0.5 transition-all cursor-pointer active:scale-[0.98]" onclick="window.terapkanPeriodeKustom()">
          <span class="material-symbols-outlined text-[19px]">check_circle</span>
          <span>Terapkan Periode</span>
        </button>
      </div>
    </div>
  </div>`;
};

window.tutupModalKustom = () => {
  const modalRoot = $("#modal-root");
  if (modalRoot) modalRoot.innerHTML = "";
};

window.gantiSubtabKustom = (mode) => {
  state.customSubmode = mode;
  window.bukaModalKustom();
};

window.terapkanPeriodeKustom = () => {
  state.periodMode = "custom";
  const single = $("#input-single-date")?.value;
  const rStart = $("#input-range-mulai")?.value;
  const rEnd = $("#input-range-sampai")?.value;
  const m = $("#select-filter-bulan")?.value;

  if (single) state.singleDate = single;
  if (rStart) state.rangeStart = rStart;
  if (rEnd) state.rangeEnd = rEnd;
  if (m) state.filterMonth = m;

  window.tutupModalKustom();
  render();
};

window.simpanBiaya = async () => {
  const nama = $("#nama-pengeluaran")?.value.trim();
  const nominal = num($("#nominal-pengeluaran")?.value);
  if (!nama || nominal <= 0)
    return alert("Mohon lengkapi keperluan dan nominal pengeluaran.");

  const exp = {
    name: nama,
    amount: nominal,
    category: "Operasional Toko",
    createdAt: serverTimestamp(),
  };

  try {
    const ref = await addDoc(collection(db, "expenses"), exp);
    state.expenses.unshift({ id: ref.id, ...exp, createdAt: new Date() });
  } catch (err) {
    state.expenses.unshift({
      id: `local-exp-${Date.now()}`,
      ...exp,
      createdAt: new Date(),
    });
  }

  toast("Pengeluaran berhasil dicatat!");
  $("#nama-pengeluaran").value = "";
  $("#nominal-pengeluaran").value = "";
  render();
};

window.exportExcel = async () => {
  if (!window.ExcelJS) {
    toast("Library Excel belum termuat. Periksa koneksi internet lalu coba lagi.", "error");
    return;
  }

  const transactions = [...state.transactions]
    .sort((a, b) => {
      const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      return bDate - aDate;
    });
  const omzet = transactions.reduce((sum, t) => sum + num(t.total), 0);
  const hpp = transactions.reduce((sum, t) => sum + num(t.costTotal), 0);
  const pengeluaran = state.expenses.reduce((sum, e) => sum + num(e.amount), 0);
  const labaBersih = omzet - hpp;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = state.settings.storeName || "Toko Dani";
  workbook.created = new Date();

  const darkGreen = "00652C";
  const lightGreen = "DCFCE7";
  const orange = "FFF1EB";
  const currencyFormat = '"Rp" #,##0';
  const thinBorder = { style: "thin", color: { argb: "D6CEC2" } };
  const fullBorder = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

  const summary = workbook.addWorksheet("Ringkasan", { views: [{ showGridLines: false }] });
  summary.mergeCells("A1:D1");
  const title = summary.getCell("A1");
  title.value = `LAPORAN KEUANGAN ${String(state.settings.storeName || "TOKO DANI").toUpperCase()}`;
  title.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: darkGreen } };
  summary.getRow(1).height = 28;
  summary.mergeCells("A2:D2");
  summary.getCell("A2").value = `Dibuat pada ${dateFmt(new Date())} • ${transactions.length} transaksi tersimpan`;
  summary.getCell("A2").alignment = { horizontal: "center" };
  summary.getCell("A2").font = { italic: true, color: { argb: "57534E" } };

  [
    ["Keterangan", "Nilai"],
    ["Omzet Penjualan", omzet],
    ["Modal Barang (HPP)", hpp],
    ["Pengeluaran Operasional", pengeluaran],
    ["Keuntungan Barang (Omzet − HPP)", labaBersih],
    ["Total Transaksi", transactions.length],
  ].forEach((row) => summary.addRow(row));
  summary.getRow(3).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: darkGreen } };
    cell.alignment = { horizontal: "center" };
    cell.border = fullBorder;
  });
  [4, 5, 6, 7, 8].forEach((rowNumber) => {
    const row = summary.getRow(rowNumber);
    row.eachCell((cell) => { cell.border = fullBorder; });
    if (rowNumber % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F5F1E9" } }; });
  });
  summary.getRow(7).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "903F00" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: orange } };
  });
  [4, 5, 6, 7].forEach((rowNumber) => { summary.getCell(`B${rowNumber}`).numFmt = currencyFormat; });
  summary.getColumn("A").width = 30;
  summary.getColumn("B").width = 20;
  summary.getColumn("C").width = 4;
  summary.getColumn("D").width = 4;

  const sheet = workbook.addWorksheet("Transaksi", { views: [{ state: "frozen", ySplit: 3, showGridLines: false }] });
  sheet.mergeCells("A1:M1");
  const transactionTitle = sheet.getCell("A1");
  transactionTitle.value = `DATA TRANSAKSI — ${state.settings.storeName || "Toko Dani"}`;
  transactionTitle.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  transactionTitle.alignment = { horizontal: "center", vertical: "middle" };
  transactionTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: darkGreen } };
  sheet.getRow(1).height = 27;
  sheet.mergeCells("A2:M2");
  sheet.getCell("A2").value = "Berisi semua transaksi yang tersimpan di Firebase saat laporan diekspor.";
  sheet.getCell("A2").font = { italic: true, color: { argb: "57534E" } };
  sheet.getCell("A2").alignment = { horizontal: "center" };

  const headers = ["No", "Nomor Transaksi", "Tanggal", "Jam", "Jumlah Item", "Rincian Barang", "Metode Bayar", "Status", "Subtotal", "Diskon", "Total / Omzet", "HPP", "Laba Kotor"];
  const headerRow = sheet.addRow(headers);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: darkGreen } };
    cell.alignment = { horizontal: "center", vertical: "center", wrapText: true };
    cell.border = fullBorder;
  });

  transactions.forEach((t, index) => {
    const timestamp = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || Date.now());
    const items = (t.items || []).map((item) => `${item.name || "Barang"} × ${num(item.qty)}`).join("; ");
    const totalItems = (t.items || []).reduce((sum, item) => sum + num(item.qty), 0);
    const row = sheet.addRow([
      index + 1,
      t.number || t.id || "-",
      timestamp,
      timestamp,
      totalItems,
      items || "-",
      t.paymentMethod || "Tunai",
      t.status || "selesai",
      num(t.subtotal || t.total),
      num(t.discount),
      num(t.total),
      num(t.costTotal),
      num(t.total) - num(t.costTotal),
    ]);
    row.eachCell((cell) => {
      cell.border = fullBorder;
      cell.alignment = { vertical: "top", wrapText: true };
    });
    if (index % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F5F1E9" } }; });
    row.getCell(3).numFmt = "dd/mm/yyyy";
    row.getCell(4).numFmt = "hh.mm";
    [9, 10, 11, 12, 13].forEach((column) => { row.getCell(column).numFmt = currencyFormat; });
  });
  sheet.autoFilter = { from: "A3", to: "M3" };
  [6, 14, 14, 10, 13, 44, 16, 14, 15, 14, 16, 15, 16].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });

  const expensesSheet = workbook.addWorksheet("Pengeluaran", { views: [{ state: "frozen", ySplit: 3, showGridLines: false }] });
  expensesSheet.mergeCells("A1:F1");
  const expenseTitle = expensesSheet.getCell("A1");
  expenseTitle.value = `CATATAN PENGELUARAN — ${state.settings.storeName || "Toko Dani"}`;
  expenseTitle.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  expenseTitle.alignment = { horizontal: "center", vertical: "middle" };
  expenseTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "903F00" } };
  expensesSheet.getRow(1).height = 27;
  expensesSheet.mergeCells("A2:F2");
  expensesSheet.getCell("A2").value = "Catatan pengeluaran yang disimpan dari halaman Keuangan.";
  expensesSheet.getCell("A2").font = { italic: true, color: { argb: "57534E" } };
  expensesSheet.getCell("A2").alignment = { horizontal: "center" };
  const expenseHeader = expensesSheet.addRow(["No", "Tanggal", "Jam", "Catatan Pengeluaran", "Kategori", "Nominal"]);
  expenseHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "903F00" } };
    cell.alignment = { horizontal: "center", vertical: "center" };
    cell.border = fullBorder;
  });
  [...state.expenses]
    .sort((a, b) => {
      const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      return bDate - aDate;
    })
    .forEach((expense, index) => {
      const date = expense.createdAt?.toDate ? expense.createdAt.toDate() : new Date(expense.createdAt || Date.now());
      const row = expensesSheet.addRow([index + 1, date, date, expense.name || "-", expense.category || "Pengeluaran", num(expense.amount)]);
      row.eachCell((cell) => {
        cell.border = fullBorder;
        cell.alignment = { vertical: "center", wrapText: true };
      });
      if (index % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1EB" } }; });
      row.getCell(2).numFmt = "dd/mm/yyyy";
      row.getCell(3).numFmt = "hh.mm";
      row.getCell(6).numFmt = currencyFormat;
    });
  expensesSheet.autoFilter = { from: "A3", to: "F3" };
  [6, 14, 10, 42, 22, 18].forEach((width, index) => { expensesSheet.getColumn(index + 1).width = width; });

  const buffer = await workbook.xlsx.writeBuffer();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  link.download = `Laporan_${(state.settings.storeName || "Toko_Dani").replace(/[^a-z0-9]+/gi, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  toast("Laporan Excel berwarna berhasil diunduh!");
};

window.cetakLaporanKeuangan = () => {
  const printRoot = $("#print-root");
  if (!printRoot) return;
  const uangMasuk = state.transactions.reduce(
    (acc, t) => acc + num(t.total),
    0,
  );
  const modal = state.transactions.reduce(
    (acc, t) => acc + num(t.costTotal),
    0,
  );
  const biaya = state.expenses.reduce((acc, e) => acc + num(e.amount), 0);
  const laba = uangMasuk - modal;

  printRoot.innerHTML = `
    <div style="max-width:280px;margin:0 auto;text-align:center;">
      <h3 style="margin:0;">${esc(state.settings.storeName || "Toko Dani")}</h3>
      <p style="margin:3px 0;font-size:11px;">LAPORAN KEUANGAN · ${getTodayDateString()}</p>
      <hr style="border:none;border-top:1px dashed #000;margin:6px 0;">
      <table class="receipt-table" style="text-align:left;font-size:12px;">
        <tr><td>Total Omzet:</td><td style="text-align:right;"><b>${money(uangMasuk)}</b></td></tr>
        <tr><td>Total Modal (HPP):</td><td style="text-align:right;">${money(modal)}</td></tr>
        <tr><td>Pengeluaran Toko:</td><td style="text-align:right;">${money(biaya)}</td></tr>
        <tr><td colspan="2"><hr style="border:none;border-top:1px dashed #000;margin:4px 0;"></td></tr>
        <tr><td><b>Keuntungan Barang:</b></td><td style="text-align:right;font-size:13px;"><b>${money(laba)}</b></td></tr>
        <tr><td>Total Transaksi:</td><td style="text-align:right;">${state.transactions.length}</td></tr>
      </table>
      <hr style="border:none;border-top:1px dashed #000;margin:6px 0;">
      <p style="font-size:10.5px;">Dicetak otomatis melalui Kasir Toko Dani</p>
    </div>
  `;
  window.print();
};

window.bagikanWALaporan = () => {
  const uangMasuk = state.transactions.reduce(
    (acc, t) => acc + num(t.total),
    0,
  );
  const modal = state.transactions.reduce(
    (acc, t) => acc + num(t.costTotal),
    0,
  );
  const biaya = state.expenses.reduce((acc, e) => acc + num(e.amount), 0);
  const laba = uangMasuk - modal;

  const text = encodeURIComponent(
    `*Laporan Keuangan ${state.settings.storeName || "Toko Dani"}*\n` +
      `Tanggal: ${getTodayDateString()}\n\n` +
      `• Omzet Penjualan: ${money(uangMasuk)} (${state.transactions.length} transaksi)\n` +
      `• Modal Kulakan: ${money(modal)}\n` +
      `• Pengeluaran: ${money(biaya)}\n` +
      `• *Keuntungan Barang: ${money(laba)}*\n\n` +
      `Alhamdulillah, operasional toko lancar!`,
  );
  window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
};

// ========================================================
// MODAL NOTA / STRUK DETAIL - MOBILE TUNED
// ========================================================
window.bukaNotaModal = (t) => {
  const modalRoot = $("#modal-root");
  if (!modalRoot) return;

  const isBatal = t.status === "dibatalkan";

  const itemsHtml = (t.items || [])
    .map(
      (i) => `
    <div class="flex justify-between text-[12.5px] text-text-primary-ink py-0.5">
      <span>${esc(i.name)} (${i.qty}×)</span>
      <span class="font-bold">${money(i.price * i.qty)}</span>
    </div>`,
    )
    .join("");

  modalRoot.innerHTML = `
  <div class="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-sm flex flex-col justify-end p-margin-mobile" id="modal-nota">
    <div class="bg-surface-cream rounded-2xl p-3.5 flex flex-col gap-2.5 border border-border-warm shadow-2xl max-w-md mx-auto w-full">
      <div class="flex items-center justify-between pb-1 border-b border-border-warm-subtle">
        <div class="flex flex-col">
          <div class="flex items-center gap-1.5">
            <span class="text-[14.5px] text-text-primary-ink font-bold">Nota #${esc(t.number || "000")}</span>
            ${
              isBatal
                ? `<span class="px-2 py-0.5 rounded-full bg-danger-soft-bg border border-danger-solid/30 text-danger-solid text-[10.5px] font-bold">Dibatalkan</span>`
                : ""
            }
          </div>
          <span class="text-[11.5px] text-text-muted-ink">${esc(state.settings.storeName || "Toko Dani")} · Kasir</span>
        </div>
        <button class="w-8 h-8 rounded-full bg-surface-sand border border-border-warm flex items-center justify-center text-text-primary-ink cursor-pointer" onclick="window.tutupModalRoot()">
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      ${
        isBatal
          ? `<div class="p-2.5 rounded-xl bg-danger-soft-bg border border-danger-solid/30 text-danger-solid flex items-center gap-2 text-[12px] font-semibold">
              <span class="material-symbols-outlined text-[18px] shrink-0">cancel</span>
              <span>Transaksi ini telah dibatalkan. Stok barang sudah dikembalikan ke toko.</span>
            </div>`
          : ""
      }

      <div class="p-2.5 rounded-xl bg-surface-container-lowest border border-border-warm-subtle flex flex-col gap-1 text-[12.5px]">
        <div class="flex flex-col border-b border-border-warm-subtle/70 pb-1.5 mb-0.5">
          ${itemsHtml}
        </div>
        <div class="flex justify-between text-text-muted-ink text-[12px]">
          <span>Subtotal:</span>
          <span>${money(t.subtotal || t.total)}</span>
        </div>
        ${
          num(t.discount) > 0
            ? `<div class="flex justify-between text-secondary text-[12px] font-semibold">
          <span>Diskon:</span>
          <span>- ${money(t.discount)}</span>
        </div>`
            : ""
        }
        <div class="flex justify-between text-text-primary-ink text-[14.5px] font-extrabold pt-1 border-t border-border-warm-subtle">
          <span>Total Belanja:</span>
          <span class="${isBatal ? "text-text-muted-ink line-through" : "text-primary"} font-bold">${money(t.total)}</span>
        </div>
        <div class="flex justify-between text-text-muted-ink text-[12px]">
          <span>Bayar (Tunai):</span>
          <span>${money(t.received || t.total)}</span>
        </div>
        <div class="flex justify-between text-text-muted-ink text-[12px]">
          <span>Kembalian:</span>
          <span class="font-bold text-primary">${money(t.change || 0)}</span>
        </div>
        <div class="flex justify-between text-text-muted-ink text-[11px] pt-0.5">
          <span>Waktu:</span>
          <span>${dateFmt(t.createdAt)}</span>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <div class="flex gap-2">
          <button class="flex-1 h-11 rounded-xl bg-surface-sand hover:bg-surface-container-warm border border-border-warm text-text-primary-ink text-[13px] font-semibold transition-all cursor-pointer" onclick="window.tutupModalRoot()">
            Tutup
          </button>
          <button class="flex-1 h-11 rounded-xl bg-primary hover:opacity-95 text-on-primary text-[13px] font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer" onclick="window.cetakNotaThermal(${JSON.stringify(t).replace(/"/g, "&quot;")})">
            <span class="material-symbols-outlined text-[18px]">print</span>
            <span>Cetak Struk</span>
          </button>
        </div>

        ${
          !isBatal
            ? `<button type="button" class="w-full h-10.5 rounded-xl bg-danger-soft-bg hover:bg-danger-solid hover:text-white border border-danger-solid/30 text-danger-solid text-[12.5px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-[0.99]" onclick="window.batalkanTransaksi('${esc(t.id || t.number)}')">
                <span class="material-symbols-outlined text-[17px]">cancel</span>
                <span>Batalkan Transaksi Ini</span>
              </button>`
            : ""
        }
      </div>
    </div>
  </div>`;
};

// Fungsi Pembatalan Transaksi (Mengembalikan Stok ke Toko & Menghapus dari Omzet)
window.batalkanTransaksi = async (targetIdOrNumber) => {
  const trans = state.transactions.find(
    (x) => x.id === targetIdOrNumber || x.number === targetIdOrNumber,
  );
  if (!trans) return alert("Data transaksi tidak ditemukan.");
  if (trans.status === "dibatalkan") {
    return alert("Transaksi ini sudah pernah dibatalkan sebelumnya.");
  }

  const konfirm = confirm(
    `⚠️ KONFIRMASI PEMBATALAN TRANSAKSI\n\nNomor: #${trans.number}\nTotal Belanja: ${money(trans.total)}\nJumlah Barang: ${(trans.items || []).length} jenis barang\n\nApakah Ibu/Anda yakin ingin MEMBATALKAN transaksi ini?\n\n• Omzet penjualan akan otomatis dikurangi kembali\n• Seluruh stok barang yang dibeli akan DIKEMBALIKAN ke persediaan toko.`,
  );
  if (!konfirm) return;

  state.busy = true;
  render();

  try {
    // 1. Update status in Firestore & kembalikan stok barang
    if (trans.id && !trans.id.startsWith("demo-")) {
      await runTransaction(db, async (tx) => {
        const transRef = doc(db, "transactions", trans.id);
        const transSnap = await tx.get(transRef);
        if (!transSnap.exists()) throw new Error("Transaksi tidak ditemukan di database.");

        // Kembalikan setiap stok barang
        for (const item of (trans.items || [])) {
          if (!item.id || item.id.startsWith("demo-")) continue;
          const prodRef = doc(db, "products", item.id);
          const prodSnap = await tx.get(prodRef);
          if (prodSnap.exists()) {
            const currentProd = prodSnap.data();
            const currentDisplay = num(currentProd.display);
            tx.update(prodRef, {
              display: currentDisplay + item.qty,
              updatedAt: serverTimestamp(),
            });
          }
        }

        // Catat mutasi stok pengembalian
        const movementRef = doc(collection(db, "stockMovements"));
        tx.set(movementRef, {
          type: "Pembatalan Transaksi",
          transactionNumber: trans.number,
          note: `Pembatalan penjualan nota #${trans.number}`,
          createdAt: serverTimestamp(),
        });

        // Tandai transaksi sebagai dibatalkan
        tx.update(transRef, {
          status: "dibatalkan",
          cancelledAt: serverTimestamp(),
        });
      });
    }

    // 2. Update state lokal
    trans.status = "dibatalkan";
    (trans.items || []).forEach((item) => {
      const p = state.products.find((prod) => prod.id === item.id);
      if (p) {
        p.display = num(p.display) + item.qty;
      }
    });

    state.busy = false;
    window.tutupModalRoot();
    toast(`Transaksi #${trans.number} dibatalkan. Stok barang telah dikembalikan!`, "check_circle");
    render();
  } catch (err) {
    state.busy = false;
    render();
    alert("Gagal membatalkan transaksi: " + err.message);
  }
};

// Fungsi Konfirmasi Hapus Barang dari Toko (Dengan Verifikasi Kata "HAPUS")
window.konfirmasiHapusBarang = async (id) => {
  const p = state.products.find((prod) => prod.id === id);
  if (!p) return;

  const verifikasi = prompt(
    `⚠️ KONFIRMASI HAPUS BARANG\n\nNama Barang: "${p.name}"\nSisa Stok: ${totalStock(p)} ${p.baseUnit || "pcs"}\nHarga Jual: ${money(p.sellPrice)}\n\nBarang ini akan dihapus permanen dari toko dan kasir.\nUntuk mencegah ketidaksengajaan, ketik kata "HAPUS" di bawah ini lalu tekan OK:`,
  );

  // Jika tombol Batal ditekan
  if (verifikasi === null) return;

  // Cek kata verifikasi
  if (verifikasi.trim().toUpperCase() !== "HAPUS") {
    return alert('Penghapusan dibatalkan. Anda harus mengetik kata "HAPUS" untuk menghapus barang.');
  }

  state.busy = true;
  render();

  try {
    if (p.id && !p.id.startsWith("local-") && !p.id.startsWith("demo-")) {
      await deleteDoc(doc(db, "products", p.id));
    }

    // Hapus dari state.products
    state.products = state.products.filter((prod) => prod.id !== id);

    // Hapus dari keranjang jika sedang dimasukkan
    state.cart = state.cart.filter((item) => item.id !== id);

    state.busy = false;
    toast(`Barang "${p.name}" berhasil dihapus dari toko!`, "delete");
    render();
  } catch (err) {
    state.busy = false;
    render();
    alert("Gagal menghapus barang: " + err.message);
  }
};

window.tutupModalRoot = () => {
  const modalRoot = $("#modal-root");
  if (modalRoot) modalRoot.innerHTML = "";
};

window.cetakNotaThermal = (t) => {
  const printRoot = $("#print-root");
  if (!printRoot) return;

  const itemsHtml = (t.items || [])
    .map(
      (i) => `
    <tr>
      <td colspan="2">${esc(i.name)}</td>
    </tr>
    <tr>
      <td>${i.qty} × ${money(i.price)}</td>
      <td style="text-align:right;">${money(i.qty * i.price)}</td>
    </tr>`,
    )
    .join("");

  printRoot.innerHTML = `
    <div style="max-width:280px;margin:0 auto;text-align:center;">
      <h3 style="margin:0;">${esc(state.settings.storeName || "Toko Dani")}</h3>
      <p style="margin:2px 0;font-size:11px;">${esc(state.settings.address || "Toko Kelontong & Sembako")}</p>
      <p style="margin:2px 0;font-size:10.5px;">Nota: ${esc(t.number)} · ${dateFmt(t.createdAt)}</p>
      <hr style="border:none;border-top:1px dashed #000;margin:5px 0;">
      <table class="receipt-table" style="text-align:left;font-size:11.5px;">
        ${itemsHtml}
        <tr><td colspan="2"><hr style="border:none;border-top:1px dashed #000;margin:3px 0;"></td></tr>
        <tr><td>Subtotal</td><td style="text-align:right;">${money(t.subtotal || t.total)}</td></tr>
        ${num(t.discount) > 0 ? `<tr><td>Diskon</td><td style="text-align:right;">-${money(t.discount)}</td></tr>` : ""}
        <tr><td><b>Total</b></td><td style="text-align:right;"><b>${money(t.total)}</b></td></tr>
        <tr><td>Tunai</td><td style="text-align:right;">${money(t.received || t.total)}</td></tr>
        <tr><td>Kembali</td><td style="text-align:right;">${money(t.change || 0)}</td></tr>
      </table>
      <hr style="border:none;border-top:1px dashed #000;margin:5px 0;">
      <p style="font-size:10.5px;margin:3px 0;">${esc(state.settings.receiptFooter || "Terima kasih telah berbelanja!")}</p>
    </div>
  `;
  window.print();
};

// ========================================================
// BARCODE SCANNER MODAL (Camera & Simulated fallback)
// ========================================================
window.startBarcodeScanner = async (targetInputId = "pos-search-input") => {
  const modalRoot = $("#modal-root");
  if (!modalRoot) return;

  if (state.scannerStream) {
    state.scannerStream.getTracks().forEach((track) => track.stop());
    state.scannerStream = null;
  }
  state.scannerControls?.stop?.();
  state.scannerControls = null;

  modalRoot.innerHTML = `
  <div class="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-sm flex flex-col justify-end p-margin-mobile" id="modal-scanner">
    <div class="bg-surface-cream rounded-2xl p-4 flex flex-col gap-3 border border-border-warm shadow-2xl max-w-md mx-auto w-full">
      <div class="flex items-center justify-between pb-1 border-b border-border-warm-subtle">
        <div class="flex items-center gap-1.5">
          <span class="material-symbols-outlined text-primary text-[20px]">barcode_scanner</span>
          <h3 class="text-[14.5px] font-bold text-text-primary-ink">Scan Barcode</h3>
        </div>
        <button class="w-8 h-8 rounded-full bg-surface-sand border border-border-warm flex items-center justify-center text-text-primary-ink" onclick="window.stopBarcodeScanner()">
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <div class="flex flex-col items-center gap-1.5">
        <video id="scanner-video" class="scanner-video-preview" autoplay playsinline muted></video>
        <p class="text-[12px] text-text-muted-ink text-center">Arahkan kamera ke barcode produk:</p>
      </div>

      <div class="flex flex-col gap-1.5">
        <div class="flex gap-1.5">
          <input type="text" id="manual-barcode-input" placeholder="Ketik barcode..." class="flex-1 h-10 px-2.5 rounded-lg bg-surface-sand border border-border-warm text-[13px] focus:outline-none focus:border-primary">
          <button type="button" class="h-10 px-3.5 rounded-lg bg-primary text-on-primary font-bold text-[12.5px]" onclick="window.submitManualBarcode('${targetInputId}')">
            Pakai
          </button>
        </div>
        <button type="button" class="h-9 rounded-lg bg-surface-sand border border-border-warm text-text-primary-ink font-semibold text-[12px] hover:bg-surface-container-warm" onclick="window.simulateScanProduct('${targetInputId}')">
          Coba Barcode Contoh
        </button>
      </div>

      <button class="h-10 rounded-xl bg-surface-sand border border-border-warm text-text-primary-ink text-[12.5px] font-semibold" onclick="window.stopBarcodeScanner()">
        Tutup
      </button>
    </div>
  </div>`;

  const video = $("#scanner-video");
  if (navigator.mediaDevices?.getUserMedia && video) {
    try {
      state.scannerStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (primaryError) {
      try {
        // Laptop biasanya hanya memiliki satu webcam tanpa label "environment".
        state.scannerStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      } catch (fallbackError) {
        const message = fallbackError?.name === "NotAllowedError"
          ? "Izin kamera ditolak. Izinkan kamera untuk halaman ini di browser."
          : fallbackError?.name === "NotReadableError"
            ? "Kamera sedang dipakai aplikasi lain. Tutup Zoom, Teams, atau aplikasi Kamera."
            : "Kamera tidak dapat dibuka. Periksa izin kamera dan perangkat kamera laptop.";
        console.warn("Camera unavailable:", primaryError, fallbackError);
        toast(message, "error");
        return;
      }
    }

    try {
      video.srcObject = state.scannerStream;
      await video.play();
      if (window.ZXingBrowser?.BrowserMultiFormatReader) {
        const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
        state.scannerControls = await reader.decodeFromVideoElement(video, (result) => {
          if (result?.getText?.()) {
            window.processBarcodeScanned(result.getText(), targetInputId);
          }
        });
      } else if ("BarcodeDetector" in window) {
        const detector = new BarcodeDetector();
        const scan = async () => {
          if (!state.scannerStream) return;
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
            try {
              const codes = await detector.detect(video);
              if (codes[0]?.rawValue) return window.processBarcodeScanned(codes[0].rawValue, targetInputId);
            } catch (e) {
              console.warn("Barcode detection failed:", e);
            }
          }
          state.scannerFrame = requestAnimationFrame(scan);
        };
        scan();
      } else {
        toast("Browser ini belum mendukung scan otomatis. Gunakan input barcode atau Chrome/Edge terbaru.", "info");
      }
    } catch (e) {
      console.warn("Camera preview could not start:", e);
      toast("Preview kamera tidak dapat dimulai. Tutup scanner lalu coba lagi.", "error");
    }
  }
};

window.stopBarcodeScanner = () => {
  if (state.scannerFrame) cancelAnimationFrame(state.scannerFrame);
  state.scannerFrame = 0;
  state.scannerControls?.stop?.();
  state.scannerControls = null;
  if (state.scannerStream) {
    state.scannerStream.getTracks().forEach((track) => track.stop());
    state.scannerStream = null;
  }
  window.tutupModalRoot();
};

window.submitManualBarcode = (targetInputId) => {
  const val = $("#manual-barcode-input")?.value.trim();
  if (val) {
    window.processBarcodeScanned(val, targetInputId);
  }
};

window.simulateScanProduct = (targetInputId) => {
  const sample = state.products[0]?.code || "8992775211012";
  window.processBarcodeScanned(sample, targetInputId);
};

window.processBarcodeScanned = (code, targetInputId) => {
  window.stopBarcodeScanner();
  if (targetInputId === "pos-search-input") {
    state.search = code;
    toast(`Barcode: ${code}`);
    render();
    // Auto add if exactly matched
    const matched = state.products.find((p) => p.code === code);
    if (matched) {
      window.tambahKeKeranjang(matched.id);
    }
  } else {
    const el = $(`#${targetInputId}`);
    if (el) el.value = code;
    toast(`Barcode terisi: ${code}`);
  }
};

// ========================================================
// PENGATURAN TOKO MODAL - MOBILE TUNED
// ========================================================
window.bukaPengaturanToko = () => {
  const modalRoot = $("#modal-root");
  if (!modalRoot) return;

  modalRoot.innerHTML = `
  <div class="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-sm flex flex-col justify-end p-margin-mobile" id="modal-settings">
    <div class="bg-surface-cream rounded-2xl p-4 flex flex-col gap-2.5 border border-border-warm shadow-2xl max-w-md mx-auto w-full">
      <div class="flex items-center justify-between pb-1 border-b border-border-warm-subtle">
        <h3 class="text-[14.5px] font-bold text-text-primary-ink">Pengaturan Toko</h3>
        <button class="w-8 h-8 rounded-full bg-surface-sand border border-border-warm flex items-center justify-center text-text-primary-ink" onclick="window.tutupModalRoot()">
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <div class="flex flex-col gap-2 text-[12.5px]">
        <div class="flex flex-col gap-0.5">
          <label class="font-bold text-[12px]">Nama Toko</label>
          <input type="text" id="setting-store-name" value="${esc(state.settings.storeName || "Toko Dani")}" class="h-10 px-2.5 rounded-lg bg-surface-sand border border-border-warm text-[13px]">
        </div>
        <div class="flex flex-col gap-0.5">
          <label class="font-bold text-[12px]">Alamat Toko</label>
          <input type="text" id="setting-store-address" value="${esc(state.settings.address || "")}" placeholder="Jl. Pasar No. 12" class="h-10 px-2.5 rounded-lg bg-surface-sand border border-border-warm text-[13px]">
        </div>
        <div class="flex flex-col gap-0.5">
          <label class="font-bold text-[12px]">Catatan Bawah Struk</label>
          <input type="text" id="setting-store-footer" value="${esc(state.settings.receiptFooter || "Terima kasih telah berbelanja")}" class="h-10 px-2.5 rounded-lg bg-surface-sand border border-border-warm text-[13px]">
        </div>
      </div>

      <div class="flex gap-2 pt-1">
        <button class="flex-1 h-10.5 rounded-xl bg-surface-sand hover:bg-surface-container-warm border border-border-warm text-[12.5px] font-semibold cursor-pointer" onclick="window.tutupModalRoot()">
          Batal
        </button>
        <button class="flex-1 h-10.5 rounded-xl bg-primary text-on-primary hover:opacity-95 text-[12.5px] font-bold cursor-pointer shadow-xs" onclick="window.simpanPengaturan()">
          Simpan
        </button>
      </div>

      <!-- Manajemen Data Toko Warung -->
      <div class="flex flex-col gap-2 pt-2.5 mt-1 border-t border-border-warm-subtle/80 text-[12.5px]">
        <div class="flex items-center gap-1.5 text-secondary font-bold text-[12px]">
          <span class="material-symbols-outlined text-[17px]">cleaning_services</span>
          <span>Pengosongan / Reset Data Warung</span>
        </div>
        <button type="button" onclick="window.resetHanyaTransaksi()" class="w-full h-10 px-3 rounded-xl bg-surface-sand hover:bg-surface-container-warm border border-border-warm text-text-muted-ink hover:text-text-primary-ink text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer">
          <span class="material-symbols-outlined text-[16px]">restart_alt</span>
          <span>Kosongkan Riwayat Transaksi & Keuangan</span>
        </button>
        <button type="button" onclick="window.resetSemuaDataWarung()" class="w-full h-11 px-3 rounded-xl bg-danger-soft-bg hover:bg-danger-solid hover:text-white border border-danger-solid/30 text-danger-solid text-[12.5px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-[0.99]">
          <span class="material-symbols-outlined text-[18px]">delete_forever</span>
          <span>Kosongkan Seluruh Data (Mulai Warung dari Nol)</span>
        </button>
      </div>
    </div>
  </div>`;
};

window.resetSemuaDataWarung = async () => {
  const confirm1 = confirm(
    "⚠️ PERINGATAN KOSONGKAN DATA:\n\nApakah Anda yakin ingin MENGOSONGKAN SELURUH DATA toko di Firebase?\n\n• Semua produk / barang dagangan akan dihapus\n• Semua riwayat transaksi kasir akan dihapus\n• Semua catatan pengeluaran & mutasi stok akan dihapus\n\nToko Dani akan bersih 100% dan siap diisi oleh Ibu dari nol."
  );
  if (!confirm1) return;

  const konfirmasi = prompt("Ketik kata 'KOSONGKAN' dengan huruf besar untuk konfirmasi:");
  if (konfirmasi !== "KOSONGKAN") {
    return alert("Penghapusan dibatalkan. Kata konfirmasi tidak cocok.");
  }

  state.busy = true;
  render();

  try {
    const colNames = ["products", "transactions", "expenses", "stockMovements"];
    for (const name of colNames) {
      const snap = await getDocs(collection(db, name));
      for (const d of snap.docs) {
        await deleteDoc(doc(db, name, d.id));
      }
    }
    state.products = [];
    state.transactions = [];
    state.expenses = [];
    state.stockMovements = [];
    state.cart = [];
    state.discount = 0;
    state.received = 0;
    state.busy = false;

    window.tutupModalRoot();
    alert("✅ SUKSES! Seluruh data di Firebase telah bersih dikosongkan.\n\nToko Dani sekarang 100% siap digunakan oleh Ibu di warung!");
    render();
  } catch (err) {
    state.busy = false;
    render();
    alert("Gagal mengosongkan data di Firebase: " + err.message);
  }
};

window.resetHanyaTransaksi = async () => {
  const confirm1 = confirm(
    "Apakah Anda ingin MENGOSONGKAN RIWAYAT TRANSAKSI & KEUANGAN?\n(Barang dagangan tetap tersimpan, hanya riwayat penjualan kasir & pengeluaran yang direset ke 0)."
  );
  if (!confirm1) return;

  state.busy = true;
  render();

  try {
    const colNames = ["transactions", "expenses", "stockMovements"];
    for (const name of colNames) {
      const snap = await getDocs(collection(db, name));
      for (const d of snap.docs) {
        await deleteDoc(doc(db, name, d.id));
      }
    }
    state.transactions = [];
    state.expenses = [];
    state.stockMovements = [];
    state.cart = [];
    state.discount = 0;
    state.received = 0;
    state.busy = false;

    window.tutupModalRoot();
    alert("✅ Riwayat transaksi & keuangan kasir berhasil dikosongkan.");
    render();
  } catch (err) {
    state.busy = false;
    render();
    alert("Gagal mengosongkan transaksi di Firebase: " + err.message);
  }
};

window.simpanPengaturan = async () => {
  const storeName = $("#setting-store-name")?.value.trim() || "Toko Dani";
  const address = $("#setting-store-address")?.value.trim() || "";
  const receiptFooter =
    $("#setting-store-footer")?.value.trim() || "Terima kasih telah berbelanja";

  state.settings.storeName = storeName;
  state.settings.address = address;
  state.settings.receiptFooter = receiptFooter;

  try {
    await setDoc(doc(db, "settings", "main"), state.settings, { merge: true });
  } catch (_) {}

  toast("Pengaturan berhasil disimpan!");
  window.tutupModalRoot();
  updateTopBar();
  render();
};

// ========================================================
// MAIN RENDER ROUTER
// ========================================================
function render() {
  const app = $("#app");
  if (!app) return;

  const hasDemoProducts = state.products.some(
    (p) => p.code === "8992775211012" || p.name === "Minyak Goreng Sania 1L",
  );
  const demoBannerHtml = hasDemoProducts
    ? `
    <div id="demo-cleaner-banner" class="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-[20px] text-amber-700 shrink-0">info</span>
        <div class="text-[12.5px] leading-tight">
          <span class="font-bold">Data Contoh / Demo Terdeteksi di Firebase.</span>
          <span class="text-amber-800"> Kosongkan data ini agar warung siap dipakai oleh Ibu dari nol.</span>
        </div>
      </div>
      <button type="button" onclick="window.resetSemuaDataWarung()" class="h-9 px-3 rounded-lg bg-danger-solid hover:opacity-90 text-white font-bold text-[12px] flex items-center justify-center gap-1 shrink-0 shadow-xs active:scale-95 transition-all cursor-pointer">
        <span class="material-symbols-outlined text-[16px]">delete_sweep</span>
        <span>Kosongkan Sekarang</span>
      </button>
    </div>`
    : "";

  let pageContent = "";
  switch (state.page) {
    case "kasir":
      pageContent = renderKasir();
      break;
    case "tambah-barang":
      pageContent = renderTambahBarang();
      break;
    case "stok-barang":
      pageContent = renderStokBarang();
      break;
    case "keuangan":
      pageContent = renderKeuangan();
      break;
    default:
      pageContent = renderKasir();
  }

  app.innerHTML = demoBannerHtml + pageContent;

  if (state.page === "tambah-barang") {
    window.recalculateMargin();
  }
}

// ========================================================
// PWA & OFFLINE SYNC HANDLERS & MODAL
// ========================================================

// Handler Instalasi Aplikasi PWA
window.installAplikasiPWA = async () => {
  const installed = await promptInstallApp();
  if (installed) {
    toast("Aplikasi Toko Dani berhasil di-install!", "download_done");
  }
};

// Handler Sinkronkan Sekarang
window.sinkronkanSekarang = async () => {
  if (!navigator.onLine) {
    return alert("Perangkat masih offline. Hubungkan ke Wi-Fi atau data seluler terlebih dahulu.");
  }

  const syncBtn = $("#btn-sync-modal");
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = `<span class="material-symbols-outlined text-[17px] animate-spin">progress_activity</span><span>Menyinkronkan...</span>`;
  }

  toast("Menyinkronkan transaksi offline...", "sync");

  try {
    const result = await syncPendingTransactions({
      db,
      runTransaction,
      doc,
      collection,
      setDoc,
      getDocs,
      query,
      where,
      serverTimestamp,
      onProgress: (successCount, total) => {
        toast(`Tersinkron: ${successCount}/${total}`, "sync");
      },
    });

    await updateOfflineTransactionsStatus();
    updateTopBar();

    if (result.successCount > 0) {
      toast(`✅ Berhasil menyinkronkan ${result.successCount} transaksi ke server!`, "cloud_done");
      // Muat ulang data terbaru
      await loadAll();
    } else if (result.failCount > 0) {
      toast(`Gagal mengirim ${result.failCount} transaksi. Akan dicoba lagi otomatis.`, "warning");
    } else {
      toast("Semua data transaksi sudah tersinkron rapi.", "check_circle");
    }

    // Refresh modal jika sedang terbuka
    if ($("#modal-antrean-offline")) {
      window.bukaModalAntreanOffline();
    }
  } catch (err) {
    toast(`Sinkronisasi tertunda: ${err.message}`, "error");
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = `<span class="material-symbols-outlined text-[17px]">sync</span><span>Sinkronkan Sekarang</span>`;
    }
  }
};

// Modal Daftar Transaksi Offline / Antrean Sinkronisasi
window.bukaModalAntreanOffline = async () => {
  const modalRoot = $("#modal-root");
  if (!modalRoot) return;

  await updateOfflineTransactionsStatus();
  const list = state.offlineTransactions || [];
  const pending = list.filter((t) => t.syncStatus === "Menunggu dikirim" || t.syncStatus === "Gagal dikirim");

  const rowsHtml = list.length
    ? list
        .map((t) => {
          let badgeClass = "bg-amber-100 text-amber-800 border-amber-300";
          let badgeIcon = "schedule";
          if (t.syncStatus === "Terkirim") {
            badgeClass = "bg-emerald-100 text-emerald-800 border-emerald-300";
            badgeIcon = "check_circle";
          } else if (t.syncStatus === "Gagal dikirim") {
            badgeClass = "bg-red-100 text-red-800 border-red-300";
            badgeIcon = "error";
          }

          return `
          <div class="p-2.5 rounded-xl bg-surface-container-lowest border border-border-warm-subtle flex flex-col gap-1.5 shadow-2xs">
            <div class="flex items-center justify-between">
              <span class="font-bold text-[13px] text-text-primary-ink">#${esc(t.number)}</span>
              <span class="px-2 py-0.5 rounded-full text-[10.5px] font-bold border flex items-center gap-1 ${badgeClass}">
                <span class="material-symbols-outlined text-[13px]">${badgeIcon}</span>
                <span>${esc(t.syncStatus || "Menunggu dikirim")}</span>
              </span>
            </div>
            <div class="flex justify-between items-center text-[12px] text-text-muted-ink">
              <span>${dateFmt(t.createdAt || t.savedOfflineAt)} · Pelanggan: <b>${esc(t.customerName || "Umum")}</b></span>
              <span class="font-extrabold text-[13px] text-primary">${money(t.total)}</span>
            </div>
            <div class="text-[11.5px] text-text-muted-ink">
              ${(t.items || []).map((it) => `${esc(it.name)} (${it.qty}x)`).join(", ")}
            </div>
            ${
              t.lastError
                ? `<div class="text-[11px] text-danger-solid bg-danger-soft-bg p-1.5 rounded-lg flex items-center gap-1 font-medium">
                    <span class="material-symbols-outlined text-[14px]">warning</span>
                    <span>${esc(t.lastError)}</span>
                  </div>`
                : ""
            }
          </div>`;
        })
        .join("")
    : `<div class="py-10 text-center text-text-muted-ink flex flex-col items-center justify-center gap-1.5">
        <span class="material-symbols-outlined text-[32px] text-text-muted-ink/50">cloud_done</span>
        <span class="text-[13px] font-semibold">Tidak ada transaksi yang mengantre</span>
        <span class="text-[11.5px]">Semua transaksi tersimpan rapi dan tersinkronkan.</span>
      </div>`;

  modalRoot.innerHTML = `
  <div class="fixed inset-0 z-50 bg-inverse-surface/60 backdrop-blur-sm flex flex-col justify-end p-margin-mobile" id="modal-antrean-offline">
    <div class="bg-surface-cream rounded-2xl p-4 flex flex-col gap-3 border border-border-warm shadow-2xl max-w-lg mx-auto w-full max-h-[85vh] overflow-y-auto">
      <div class="flex items-center justify-between pb-1 border-b border-border-warm-subtle">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg ${state.isOnline ? "bg-emerald-500" : "bg-amber-500"} text-white flex items-center justify-center font-bold shadow-2xs">
            <span class="material-symbols-outlined text-[19px]">${state.isOnline ? "wifi" : "wifi_off"}</span>
          </div>
          <div>
            <h3 class="text-[14.5px] font-bold text-text-primary-ink">Status Koneksi & Antrean Transaksi</h3>
            <p class="text-[11px] text-text-muted-ink">
              Status: <b class="${state.isOnline ? "text-emerald-700" : "text-amber-700"}">${state.isOnline ? "Online (Terhubung Server)" : "Offline (Tersimpan Lokal)"}</b>
            </p>
          </div>
        </div>
        <button class="w-8 h-8 rounded-full bg-surface-sand border border-border-warm flex items-center justify-center text-text-primary-ink cursor-pointer" onclick="window.tutupModalRoot()">
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <!-- Ringkasan Info Antrean -->
      <div class="p-3 rounded-xl ${pending.length ? "bg-amber-50 border border-amber-300 text-amber-900" : "bg-surface-sand border border-border-warm-subtle text-text-primary-ink"} text-[12px] flex items-center justify-between shadow-2xs">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[20px] ${pending.length ? "text-amber-700" : "text-primary"}">sync_alt</span>
          <div>
            <span class="font-bold">${pending.length} transaksi</span>
            <span class="text-text-muted-ink"> belum disinkronkan ke server</span>
          </div>
        </div>
        <button
          type="button"
          id="btn-sync-modal"
          onclick="window.sinkronkanSekarang()"
          class="h-9 px-3 rounded-xl bg-primary hover:opacity-95 text-on-primary text-[12px] font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer ${
            !state.isOnline || !pending.length ? "opacity-60 cursor-not-allowed" : ""
          }"
          ${!state.isOnline || !pending.length ? "disabled" : ""}
        >
          <span class="material-symbols-outlined text-[16px]">sync</span>
          <span>Sinkronkan Sekarang</span>
        </button>
      </div>

      <!-- Daftar Transaksi Offline di IndexedDB -->
      <div class="flex flex-col gap-2 max-h-[380px] overflow-y-auto no-scrollbar">
        ${rowsHtml}
      </div>

      <div class="pt-1 border-t border-border-warm-subtle flex justify-end">
        <button class="w-full h-10 rounded-xl bg-surface-sand hover:bg-surface-container-warm border border-border-warm text-text-primary-ink text-[12.5px] font-semibold cursor-pointer" onclick="window.tutupModalRoot()">
          Tutup
        </button>
      </div>
    </div>
  </div>`;
};

// Global Event Listeners for Bottom Navigation & PWA Initializer
document.addEventListener("DOMContentLoaded", () => {
  $$("#bottom-nav .nav-tab-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const path = btn.dataset.path;
      if (path) window.pindahHalaman(path);
    });
  });

  // Daftarkan Service Worker
  registerServiceWorker();

  // Inisialisasi event PWA (Online/Offline/BeforeInstallPrompt)
  initPWAEvents({
    onConnectionChange: (online) => {
      state.isOnline = online;
      updateTopBar();
      if (online) {
        toast("Koneksi internet kembali ONLINE!", "cloud_done");
        // Otomatis sinkronkan transaksi tertunda
        window.sinkronkanSekarang();
      } else {
        toast("Aplikasi beralih ke mode OFFLINE. Transaksi tetap tersimpan aman.", "cloud_off");
      }
    },
    onInstallableChange: (canInstall) => {
      state.canInstallPWA = canInstall;
      updateTopBar();
    },
  });

  // Dengarkan sinyal sinkronisasi dari Service Worker (Background Sync)
  window.addEventListener("app:trigger-sync", () => {
    console.log("[App] Menerima sinyal sinkronisasi otomatis");
    window.sinkronkanSekarang();
  });
});

// Auto initialize app
loadAll();
