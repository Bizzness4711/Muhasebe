// Firebase yapılandırması
const firebaseConfig = {
    apiKey: "AIzaSyCmBhsXLkFjQnTdNYXH2IEOAUxAllKOXyA",
    authDomain: "bizzness-in-muhasebesi.firebaseapp.com",
    projectId: "bizzness-in-muhasebesi",
    storageBucket: "bizzness-in-muhasebesi.firebasestorage.app",
    messagingSenderId: "140794309361",
    appId: "1:140794309361:web:bd6fa42aa10f0e971e9750",
    measurementId: "G-E5XMM1PBVC"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let accounts = [];
let transactions = [];
let transfers = [];
let recurringTransactions = [];
let goals = [];
let selectedType = 'expense';
let currentCurrency = 'TRY';
let selectedAccounts = new Set();
let currentMonth = new Date().toISOString().substring(0, 7);
let reportPeriod = 'month';
let currentThemeColor = '#9C27B0';
let exchangeRates = { TRY: 1, USD: 0, EUR: 0, GRAM_ALTIN: 0, CEYREK_ALTIN: 0 };
let isHidden = false;
let totalBalanceVisible = false;
let privacyModeUnsubscribe = null;
let securityTimeoutId = null;
let securityLocked = false;
let securityActivityBound = false;
let rateRefreshIntervalId = null;
let editingTransactionId = null;
let recurringProcessingPromise = null;
let notifications = [];
let budgets = [];
let isAdmin = false;
let userRole = 'user';
const APP_VERSION = 'v2026.09';

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

function getNextRecurringDate(dateString, frequency) {
    const date = new Date(`${dateString}T12:00:00`);
    if (frequency === 'weekly') date.setDate(date.getDate() + 7);
    else if (frequency === 'yearly') date.setFullYear(date.getFullYear() + 1);
    else date.setMonth(date.getMonth() + 1);
    return date.toISOString().split('T')[0];
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    const icon = document.createElement('i');
    icon.className = `fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`;
    const text = document.createElement('span');
    text.textContent = String(message);
    toast.append(icon, text);
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// Bildirimler: users/{uid}/notifications koleksiyonunda saklanır (en fazla 40).
// Her pazartesi 00:00'dan eski kayıtlar girişte otomatik silinir.
function notificationStorageKey() {
    return currentUser ? `notifications-${currentUser.uid}` : 'notifications';
}

function notifCollection() {
    return db.collection('users').doc(currentUser.uid).collection('notifications');
}

function mondayTs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
}

async function loadNotifications() {
    // Tek seferlik: eski localStorage bildirimlerini kalıcı sil.
    try { localStorage.removeItem(notificationStorageKey()); } catch (e) {}
    notifications = [];
    if (!currentUser) { updateNotificationsUI(); return; }
    try {
        const snap = await notifCollection().orderBy('ts', 'desc').limit(80).get();
        const cut = mondayTs();
        const olds = [];
        const actives = [];
        snap.forEach(doc => {
            const d = doc.data() || {};
            if (!Number(d.ts) || d.ts < cut) { olds.push(doc.ref); return; }
            if (d.deleted) return; // silinenler kullanıcıya gösterilmez, adminde durur
            actives.push({ id: doc.id, key: d.key || '', title: d.title || 'Finora', message: d.message || '', icon: d.icon || 'fa-bell', read: !!d.read, ts: d.ts });
        });
        notifications = actives.slice(0, 40);
        // 40 kaydı aşan aktifleri silinmiş işaretle (fiziksel silme pazartesi).
        for (const item of actives.slice(40)) {
            try { await notifCollection().doc(item.id).update({ deleted: true, deletedAt: Date.now() }); } catch (e) {}
        }
        for (const ref of olds) { try { await ref.delete(); } catch (e) {} }
    } catch (error) {
        console.warn('Bildirimler okunamadı.', error);
        notifications = [];
    }
    updateNotificationsUI();
}

function saveNotifications() {
    // Okundu bilgisini Firestore'a yazar (ateşle-unut).
    if (!currentUser) return;
    notifications.forEach(item => {
        if (!item.id || item._savedRead === item.read) return;
        item._savedRead = item.read;
        notifCollection().doc(item.id).update({ read: item.read }).catch(() => {});
    });
}

// Bildirim sesi: Web Audio ile kısa bip. Tarayıcılar ses için kullanıcı etkileşimi
// ister, ilk tıklamada context açılır (main.js içinde unlock edilir).
let notifAudioCtx = null;

function unlockNotifAudio() {
    try {
        if (!notifAudioCtx) notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (notifAudioCtx.state === 'suspended') notifAudioCtx.resume();
    } catch (e) { /* sessiz geç */ }
}

function isNotifSoundOn() {
    if (!currentUser) return true;
    return localStorage.getItem(`notif-sound-${currentUser.uid}`) !== 'off';
}

function playNotificationSound() {
    try {
        if (!isNotifSoundOn()) return;
        unlockNotifAudio();
        if (!notifAudioCtx) return;
        const now = notifAudioCtx.currentTime;
        const osc = notifAudioCtx.createOscillator();
        const gain = notifAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(notifAudioCtx.destination);
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.start(now);
        osc.stop(now + 0.5);
    } catch (e) {
        console.warn('Bildirim sesi çalınamadı.', e);
    }
}

function addNotification(id, message, icon = 'fa-bell', title = 'Finora') {
    if (notifications.some(item => item.key === id || item.id === id)) return;
    const item = { id: '', key: id, message, icon, title, read: false, ts: Date.now() };
    notifications.unshift(item);
    notifications = notifications.slice(0, 40);
    updateNotificationsUI();
    playNotificationSound();
    if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(title, { body: message, icon: 'icons/logo-192.png' }); } catch (e) { console.warn('Masaüstü bildirimi gösterilemedi.', e); }
    }
    if (!currentUser) return;
    notifCollection().add({ key: id, message, icon, title, read: false, ts: item.ts })
        .then(ref => { item.id = ref.id; })
        .catch(e => console.warn('Bildirim yazılamadı.', e));
}

function updateNotificationsUI() {
    const list = document.getElementById('notificationList');
    const count = document.getElementById('notificationCount');
    if (!list || !count) return;
    const unread = notifications.filter(item => !item.read);
    count.textContent = unread.length > 99 ? '99+' : String(unread.length);
    count.hidden = unread.length === 0;
    list.innerHTML = notifications.length
        ? notifications.slice(0, 12).map(item => `<div class="notification-item"><i class="fas ${escapeHtml(item.icon)}"></i><span><strong>${escapeHtml(item.title || 'Finora')}</strong> · ${escapeHtml(item.message)}</span><button class="delete-btn" onclick="event.stopPropagation();deleteNotification('${item.id}')" title="Bildirimi sil"><i class="fas fa-times"></i></button></div>`).join('')
        : '<div class="notification-empty">Yeni bildiriminiz yok.</div>';
}

window.deleteNotification = function (id) {
    const item = notifications.find(n => n.id === id || n.key === id);
    notifications = notifications.filter(n => n !== item);
    // Yumuşak silme: kayıt durur, admin görmeye devam eder.
    if (item && item.id && currentUser) notifCollection().doc(item.id).update({ deleted: true, deletedAt: Date.now() }).catch(() => {});
    updateNotificationsUI();
};

window.clearAllNotifications = async function () {
    if (!notifications.length || !confirm('Tüm bildirimler silinsin mi?')) return;
    const ids = notifications.filter(n => n.id).map(n => n.id);
    notifications = [];
    updateNotificationsUI();
    if (!currentUser) return;
    for (const did of ids) { try { await notifCollection().doc(did).update({ deleted: true, deletedAt: Date.now() }); } catch (e) {} }
};

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showToast('Bu tarayıcı masaüstü bildirimlerini desteklemiyor.', 'error');
        return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted' && typeof initPush === 'function') initPush();
    showToast(permission === 'granted' ? 'Masaüstü bildirimleri açıldı.' : 'Bildirim izni verilmedi.', permission === 'granted' ? 'success' : 'error');
}

// Otomatik kontroller: bugünkü tekrarlayan işlemler + hedef kilometre taşları + bütçe uyarıları.
// (Piyasa hareketi bildirimi bilinçli olarak yok: her açılışta gürültü yapıyordu.)
function checkNotifications() {
    if (!currentUser) return;
    const today = new Date().toISOString().split('T')[0];
    transactions.filter(item => item.recurringId && item.date === today).forEach(item => {
        addNotification(`recurring-${item.id}`, `Tekrarlayan işlem oluşturuldu: ${item.description}.`, 'fa-rotate');
    });

    goals.forEach(goal => {
        const progress = goal.amount > 0 ? (goal.current / goal.amount) * 100 : 0;
        const milestone = progress >= 100 ? 100 : progress >= 75 ? 75 : progress >= 50 ? 50 : progress >= 25 ? 25 : 0;
        if (milestone > 0) addNotification(`goal-${goal.id}-${milestone}`, `${goal.name} hedefiniz %${milestone} seviyesine ulaştı${milestone === 100 ? '!' : '.'}`, 'fa-bullseye');
    });

    budgets.filter(b => b.month === currentMonth).forEach(budget => {
        const spent = getBudgetSpent(budget.category, budget.month);
        const limit = Number(budget.limit) || 0;
        if (!(limit > 0)) return;
        const pct = (spent / limit) * 100;
        if (pct >= 100) addNotification(`budget-${budget.month}-${budget.category}-over`, `${budget.category} bütçesi aşıldı: ₺${spent.toFixed(2)} / ₺${limit.toFixed(2)}.`, 'fa-triangle-exclamation');
        else if (pct >= 80) addNotification(`budget-${budget.month}-${budget.category}-warn`, `${budget.category} bütçesinin %${pct.toFixed(0)} kullanıldı.`, 'fa-wallet');
    });
}

// Bütçeler
async function loadBudgets() {
    if (!currentUser) { budgets = []; return; }
    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('budgets').get();
        budgets = [];
        snap.forEach(doc => budgets.push({ id: doc.id, ...doc.data() }));
    } catch (error) {
        if (error.code === 'permission-denied') console.warn('Bütçeler için Firestore kuralı eksik.', error);
        else console.warn('Bütçeler yüklenemedi.', error);
        budgets = [];
    }
}

function getBudgetSpent(category, month) {
    return transactions
        .filter(t => t.type === 'expense' && t.category === category && String(t.date || '').startsWith(month))
        .reduce((sum, t) => sum + getTransactionValueTL(t), 0);
}

function updateBudgetsUI() {
    const list = document.getElementById('budgetsList');
    const monthBudgets = budgets.filter(b => b.month === currentMonth);
    if (list) {
        if (!monthBudgets.length) {
            list.innerHTML = '<p class="empty-state">Bu aya ait bütçe yok. Yukarıdan ekleyin.</p>';
        } else {
            list.innerHTML = monthBudgets.map(b => {
                const limit = Number(b.limit) || 0;
                const spent = getBudgetSpent(b.category, b.month);
                const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
                const barClass = spent >= limit ? 'over' : (spent / limit) >= 0.8 ? 'warn' : '';
                const hidden = isHidden ? '₺••••••' : `₺${spent.toFixed(2)} / ₺${limit.toFixed(2)}`;
                return `<div class="budget-card">
                    <div class="budget-card-header"><strong>${escapeHtml(b.category)}</strong>
                    <button class="delete-btn" onclick="deleteBudget('${b.id}')" title="Bütçeyi sil"><i class="fas fa-trash"></i></button></div>
                    <div class="goal-progress-bar"><div class="goal-progress-fill budget-fill ${barClass}" style="width:${pct.toFixed(1)}%"></div></div>
                    <div class="goal-amounts"><span>${hidden}</span><span>%${(limit > 0 ? (spent / limit) * 100 : 0).toFixed(0)}</span></div>
                </div>`;
            }).join('');
        }
    }
    const overview = document.getElementById('budgetOverview');
    const overviewCard = document.getElementById('budgetOverviewCard');
    if (overview && overviewCard) {
        const ranked = monthBudgets
            .map(b => ({ ...b, pct: (Number(b.limit) > 0 ? getBudgetSpent(b.category, b.month) / Number(b.limit) : 0) }))
            .sort((a, b) => b.pct - a.pct)
            .slice(0, 5);
        if (!ranked.length) {
            overviewCard.style.display = 'none';
        } else {
            overviewCard.style.display = 'block';
            overview.innerHTML = ranked.map(b => {
                const barClass = b.pct >= 1 ? 'over' : b.pct >= 0.8 ? 'warn' : '';
                return `<div class="budget-row"><span>${escapeHtml(b.category)}</span>
                    <div class="goal-progress-bar budget-mini-bar"><div class="goal-progress-fill budget-fill ${barClass}" style="width:${Math.min(100, b.pct * 100).toFixed(1)}%"></div></div>
                    <strong>%${(b.pct * 100).toFixed(0)}</strong></div>`;
            }).join('');
        }
    }
}

window.deleteBudget = async function (id) {
    if (!currentUser || !confirm('Bu bütçe silinsin mi?')) return;
    try {
        await db.collection('users').doc(currentUser.uid).collection('budgets').doc(id).delete();
        showToast('Bütçe silindi.', 'success');
        await loadBudgets();
        updateBudgetsUI();
    } catch (error) { showToast('Bütçe silinemedi: ' + error.message, 'error'); }
};

// Firestore'dan gelen kullanıcı metinlerini HTML içine yazmadan önce güvenli hale getir.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function securityStorageKey(suffix) {
    return currentUser ? `security-${suffix}-${currentUser.uid}` : null;
}

async function hashSecurityPin(pin) {
    const data = new TextEncoder().encode(pin);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function hasSecurityPin() {
    return Boolean(securityStorageKey('pin') && localStorage.getItem(securityStorageKey('pin')));
}

function isSecurityAppLocked() {
    return Boolean(securityStorageKey('locked') && localStorage.getItem(securityStorageKey('locked')) === 'true');
}

function getSecurityTimeoutMinutes() {
    const value = Number(localStorage.getItem(securityStorageKey('timeout') || '') || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function scheduleSecurityLock() {
    if (securityTimeoutId) clearTimeout(securityTimeoutId);
    if (!currentUser || securityLocked || !hasSecurityPin()) return;
    const minutes = getSecurityTimeoutMinutes();
    if (minutes > 0) securityTimeoutId = setTimeout(lockSecurityApp, minutes * 60 * 1000);
}

function lockSecurityApp() {
    if (!hasSecurityPin() || securityLocked) return;
    securityLocked = true;
    localStorage.setItem(securityStorageKey('locked'), 'true');
    const lock = document.getElementById('securityLock');
    if (lock) lock.hidden = false;
    const pin = document.getElementById('unlockPin');
    if (pin) { pin.value = ''; pin.focus(); }
    if (securityTimeoutId) clearTimeout(securityTimeoutId);
}

function unlockSecurityApp() {
    securityLocked = false;
    localStorage.removeItem(securityStorageKey('locked'));
    const lock = document.getElementById('securityLock');
    if (lock) lock.hidden = true;
    const error = document.getElementById('unlockError');
    if (error) error.textContent = '';
    scheduleSecurityLock();
}

async function configureSecurityUI() {
    const timeout = document.getElementById('securityTimeout');
    if (timeout) timeout.value = String(getSecurityTimeoutMinutes());
    if (!securityActivityBound) {
        ['click', 'keydown', 'pointermove', 'touchstart'].forEach(eventName => {
            document.addEventListener(eventName, () => {
                if (!securityLocked) scheduleSecurityLock();
            }, { passive: true });
        });
        securityActivityBound = true;
    }
    if (isSecurityAppLocked()) {
        securityLocked = false;
        lockSecurityApp();
    } else {
        scheduleSecurityLock();
    }
}

function scheduleRateRefresh() {
    if (rateRefreshIntervalId) clearInterval(rateRefreshIntervalId);
    if (!currentUser) return;
    rateRefreshIntervalId = setInterval(() => {
        fetchExchangeRates();
    }, 60 * 60 * 1000);
}


function applyThemeColor() {
    const hexColor = '#9C27B0';
    const rgb = hexToRgb(hexColor);
    currentThemeColor = hexColor;

    document.documentElement.style.setProperty('--primary-color', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
    document.documentElement.style.setProperty('--primary-dark', `rgb(${Math.round(rgb.r * 0.8)}, ${Math.round(rgb.g * 0.8)}, ${Math.round(rgb.b * 0.8)})`);
    document.documentElement.style.setProperty('--primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);

    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.classList.remove('active');
    });
}

function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

const RATES_CACHE_KEY = 'finance-rates-cache-v1';
let ratesStatus = 'unknown';

function loadRatesFromCache() {
    try {
        const raw = localStorage.getItem(RATES_CACHE_KEY);
        if (!raw) return false;
        const cached = JSON.parse(raw);
        if (!cached) return false;
        ['USD', 'EUR', 'GRAM_ALTIN', 'CEYREK_ALTIN'].forEach(key => {
            const value = Number(cached[key]);
            if (value > 0) exchangeRates[key] = value;
        });
        ratesStatus = 'cache';
        return true;
    } catch (e) {
        console.warn('Kur önbelleği okunamadı.', e);
        return false;
    }
}

function saveRatesToCache() {
    try {
        localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({
            USD: exchangeRates.USD,
            EUR: exchangeRates.EUR,
            GRAM_ALTIN: exchangeRates.GRAM_ALTIN,
            CEYREK_ALTIN: exchangeRates.CEYREK_ALTIN,
            ts: Date.now()
        }));
    } catch (e) {
        console.warn('Kur önbelleği yazılamadı.', e);
    }
}

async function fetchWithTimeout(url, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal, mode: 'cors' });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchRatesWithFallback(sources) {
    for (const source of sources) {
        try {
            const response = await fetchWithTimeout(source.url, 6000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const parsed = source.parse(data);
            if (parsed) return parsed;
            throw new Error('Ayrıştırma başarısız');
        } catch (e) {
            console.warn(`Kur kaynağı başarısız, sonrakine geçiliyor: ${source.url}`, e?.message || e);
        }
    }
    return null;
}

loadRatesFromCache();

async function fetchExchangeRates() {
    try {
    const forexResult = await fetchRatesWithFallback([
        {
            url: 'https://open.er-api.com/v6/latest/USD',
            parse: (data) => {
                const usdTry = Number(data?.rates?.TRY);
                const eurPerUsd = Number(data?.rates?.EUR);
                if (!(usdTry > 0) || !(eurPerUsd > 0)) return null;
                return { USD: usdTry, EUR: usdTry / eurPerUsd };
            }
        },
        {
            url: 'https://api.frankfurter.app/latest?from=USD&to=TRY,EUR',
            parse: (data) => {
                const usdTry = Number(data?.rates?.TRY);
                const eurPerUsd = Number(data?.rates?.EUR);
                if (!(usdTry > 0) || !(eurPerUsd > 0)) return null;
                return { USD: usdTry, EUR: usdTry / eurPerUsd };
            }
        },
        {
            url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
            parse: (data) => {
                const usdTry = Number(data?.usd?.try);
                const eurPerUsd = Number(data?.usd?.eur);
                if (!(usdTry > 0) || !(eurPerUsd > 0)) return null;
                return { USD: usdTry, EUR: usdTry / eurPerUsd };
            }
        },
        {
            url: 'https://api.exchangerate-api.com/v4/latest/USD',
            parse: (data) => {
                const usdTry = Number(data?.rates?.TRY);
                const eurPerUsd = Number(data?.rates?.EUR);
                if (!(usdTry > 0) || !(eurPerUsd > 0)) return null;
                return { USD: usdTry, EUR: usdTry / eurPerUsd };
            }
        }
    ]);

    let forexLive = false;
    if (forexResult) {
        if (forexResult.USD > 0) exchangeRates.USD = forexResult.USD;
        if (forexResult.EUR > 0) exchangeRates.EUR = forexResult.EUR;
        forexLive = true;
    } else {
        console.warn('Döviz kurları güncellenemedi, önbellek kullanılıyor.');
    }

    const usdTryForGold = Number(exchangeRates.USD) || 0;
    const goldResult = await fetchRatesWithFallback([
        {
            url: 'https://api.gold-api.com/price/XAU',
            parse: (data) => {
                const ounceUsd = Number(data?.price);
                if (!(ounceUsd > 0) || !(usdTryForGold > 0)) return null;
                return { gramTry: ounceUsd / 31.1035 * usdTryForGold };
            }
        },
        {
            url: 'https://api.metalpriceapi.com/v1/latest?api_key=demo&base=USD&currencies=XAU',
            parse: (data) => {
                const rates = data?.rates || {};
                const xau = Number(rates.XAU ?? rates.xau);
                if (!(xau > 0)) return null;
                // xau: 1 USD = x XAU ise ons fiyatı = 1/xau USD
                if (xau < 0.01 && usdTryForGold > 0) return { gramTry: (1 / xau) / 31.1035 * usdTryForGold };
                if (xau > 100 && usdTryForGold > 0) return { gramTry: xau / 31.1035 * usdTryForGold };
                return null;
            }
        },
        {
            url: 'https://data-asg.goldprice.org/dbXRates/TRY',
            parse: (data) => {
                const item = data?.items?.[0];
                const xauPrice = Number(item?.xauPrice);
                if (!(xauPrice > 0)) return null;
                // TRY bazlı ons fiyatıysa grama çevir, zaten gram fiyatsa direkt al.
                if (xauPrice > 1000) return { gramTry: xauPrice / 31.1035 };
                return { gramTry: xauPrice };
            }
        },
        {
            url: 'https://xaus.com/api/v1/spot?currency=TRY&unit=gram',
            parse: (data) => {
                const gramPrice = Number(data?.xau?.price);
                if (!(gramPrice > 0)) return null;
                return { gramTry: gramPrice };
            }
        }
    ]);

    let goldLive = false;
    if (goldResult && goldResult.gramTry > 0) {
        exchangeRates.GRAM_ALTIN = goldResult.gramTry;
        // Standart çeyrek altın: 1,75 gr ve 22 ayar (22/24 saf altın oranı).
        exchangeRates.CEYREK_ALTIN = goldResult.gramTry * 1.75 * (22 / 24);
        goldLive = true;
    } else {
        console.warn('Altın kurları güncellenemedi, önbellek kullanılıyor.');
    }

    if (forexLive && goldLive) {
        ratesStatus = 'live';
        saveRatesToCache();
    } else if (forexLive || goldLive) {
        // Kısmi başarı: canlı geleni kaydet, durumu cache (turuncu) say.
        ratesStatus = 'cache';
        saveRatesToCache();
    } else {
        loadRatesFromCache();
        const hasValues = exchangeRates.USD > 0 || exchangeRates.GRAM_ALTIN > 0;
        ratesStatus = hasValues ? 'cache' : 'error';
    }
    } finally {
        updateExchangeRatesDisplay();
        if (currentUser) {
            updateAllUI();
        }
    }
}

function updateExchangeRatesDisplay() {
    const rateUSD = document.getElementById('rateUSD');
    const rateEUR = document.getElementById('rateEUR');
    const rateGRAM = document.getElementById('rateGRAM');
    const rateCEYREK = document.getElementById('rateCEYREK');
    const lastRateUpdate = document.getElementById('lastRateUpdate');
    const formatRate = rate => rate > 0 ? `₺${rate.toFixed(2)}` : 'Yüklenemedi';
    if (rateUSD) rateUSD.textContent = formatRate(exchangeRates.USD);
    if (rateEUR) rateEUR.textContent = formatRate(exchangeRates.EUR);
    if (rateGRAM) rateGRAM.textContent = formatRate(exchangeRates.GRAM_ALTIN);
    if (rateCEYREK) rateCEYREK.textContent = formatRate(exchangeRates.CEYREK_ALTIN);
    if (lastRateUpdate) lastRateUpdate.textContent = new Date().toLocaleTimeString('tr-TR');
    const statusDot = document.getElementById('ratesStatusDot');
    if (statusDot) {
        const colors = { live: 'var(--income-color)', cache: 'var(--warning-color)', error: 'var(--expense-color)' };
        statusDot.style.background = colors[ratesStatus] || 'var(--text-secondary)';
        statusDot.title = ratesStatus === 'live' ? 'Kurlar canlı' : ratesStatus === 'cache' ? 'Önbellekten gösteriliyor' : ratesStatus === 'error' ? 'Kurlar alınamadı' : 'Kur durumu';
    }
    updateAccountRateInfo();
    updateTransactionPurchaseFields();
}

function updateAccountRateInfo() {
    const accountSelect = document.getElementById('accountSelect');
    const rateInfo = document.getElementById('accountRateInfo');
    if (!accountSelect || !rateInfo) return;

    const selectedAccount = accounts.find(account => account.id === accountSelect.value);
    if (!selectedAccount || selectedAccount.currency === 'TRY') {
        rateInfo.hidden = true;
        rateInfo.textContent = '';
        return;
    }

    const accountRate = Number(selectedAccount.openingRate || selectedAccount.buyPrice || 0);
    const rateMessages = {
        USD: `1 USD = ₺${(accountRate || (exchangeRates.USD || 0)).toFixed(2)}`,
        EUR: `1 EUR = ₺${(accountRate || (exchangeRates.EUR || 0)).toFixed(2)}`,
        GRAM_ALTIN: `1 gram altın = ₺${(accountRate || (exchangeRates.GRAM_ALTIN || 0)).toFixed(2)}`,
        CEYREK_ALTIN: `1 çeyrek altın = ₺${(accountRate || (exchangeRates.CEYREK_ALTIN || 0)).toFixed(2)}`
    };

    const message = rateMessages[selectedAccount.currency] || `${selectedAccount.currency} fiyatı: ₺${(accountRate || (exchangeRates[selectedAccount.currency] || 0)).toFixed(2)}`;
    rateInfo.textContent = `${selectedAccount.name} için ${message} (hesap giriş fiyatı)`;
    rateInfo.hidden = false;
}

function getAccountOpeningRate(account) {
    if (!account || !isInvestmentAccount(account)) return 0;
    return Number(account.openingRate || account.buyPrice || 0);
}

function getCurrencyRateLabel(currency, rate) {
    const labels = {
        USD: '1 USD',
        EUR: '1 EUR',
        GRAM_ALTIN: '1 gram altın',
        CEYREK_ALTIN: '1 çeyrek altın'
    };
    return `${labels[currency] || currency} = ₺${rate.toFixed(2)}`;
}

function updateTransactionPurchaseFields() {
    const accountSelect = document.getElementById('accountSelect');
    const details = document.getElementById('transactionPurchaseDetails');
    const input = document.getElementById('transactionPurchaseRate');
    const label = document.getElementById('transactionPurchaseLabel');
    const account = accounts.find(item => item.id === accountSelect?.value);
    const installmentDetails = document.getElementById('creditInstallmentDetails');
    if (installmentDetails) installmentDetails.hidden = account?.type !== 'credit';
    const visible = isInvestmentAccount(account);
    if (!details || !input || !label) return;
    details.hidden = !visible;
    input.required = visible;
    if (visible) {
        const currentRate = Number(exchangeRates[account.currency] || 0);
        label.textContent = `${account.currency === 'GRAM_ALTIN' ? 'Gram altını' : account.currency === 'CEYREK_ALTIN' ? 'Çeyrek altını' : account.currency} bu işlemde kaça aldınız? (₺)`;
        document.getElementById('transactionPurchaseHint').textContent =
            currentRate > 0 ? `Güncel kur: ₺${currentRate.toFixed(2)}. Aradaki fark kâr/zarar olarak hesaplanır.` : 'Güncel kur alınamadı; yine de alış fiyatını girin.';
    } else {
        input.value = '';
    }
}

function formatMonth(monthString) {
    if (!monthString) return '';
    const [year, month] = monthString.split('-').map(Number);
    const monthNames = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    return `${monthNames[month-1]} ${year}`;
}

window.changeMonth = function(delta) {
    let [year, month] = currentMonth.split('-').map(Number);
    month += delta;
    if (month > 12) { month = 1; year++; }
    if (month < 1) { month = 12; year--; }
    currentMonth = `${year}-${String(month).padStart(2, '0')}`;
    const monthDisplay = document.getElementById('currentMonthDisplay');
    if (monthDisplay) monthDisplay.textContent = formatMonth(currentMonth);
    updateDashboard();
    if (currentUser) saveSettings();
};

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        securityLocked = false;
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        const userName = user.displayName || user.email.split('@')[0];
        document.getElementById('userName').textContent = userName;
        document.getElementById('userAvatar').innerHTML = userName.charAt(0).toUpperCase();

        isHidden = true;
        totalBalanceVisible = false;
        updateAllUI();

        subscribeToPrivacyMode(user.uid);
        await fetchExchangeRates();
        await loadUserData();
        await configureSecurityUI();
        scheduleRateRefresh();
    } else {
        if (privacyModeUnsubscribe) {
            privacyModeUnsubscribe();
            privacyModeUnsubscribe = null;
        }
        currentUser = null;
        if (rateRefreshIntervalId) clearInterval(rateRefreshIntervalId);
        rateRefreshIntervalId = null;
        securityLocked = false;
        if (securityTimeoutId) clearTimeout(securityTimeoutId);
        const securityLock = document.getElementById('securityLock');
        if (securityLock) securityLock.hidden = true;
        setPrivacyModeUI(false);
        document.getElementById('loginModal').style.display = 'flex';
        document.getElementById('app').style.display = 'none';
    }
});

async function loadUserData() {
    if (!currentUser) return;
    try {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        if (!userDoc.exists) {
            isHidden = false;
            await db.collection('users').doc(currentUser.uid).set({
                name: currentUser.displayName || currentUser.email,
                email: currentUser.email,
                currency: 'TRY',
                currentMonth: currentMonth,
                selectedAccounts: [],
                themeColor: '#9C27B0',
                privacyModeEnabled: false,
                role: 'user',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            const settings = userDoc.data();
            currentCurrency = 'TRY';
            userRole = settings.role === 'admin' ? 'admin' : 'user';
            isAdmin = userRole === 'admin';
            updateAdminVisibility();
            if (isAdmin && typeof window.loadAdminData === 'function') window.loadAdminData();
            if (settings.currentMonth) currentMonth = settings.currentMonth;
            currentThemeColor = '#9C27B0';
            applyThemeColor();
            isHidden = Boolean(settings.privacyModeEnabled);
            if (settings.selectedAccounts && settings.selectedAccounts.length > 0) {
                selectedAccounts = new Set(settings.selectedAccounts);
            } else {
                selectedAccounts = new Set();
            }
        }

        const accountsSnapshot = await db.collection('users').doc(currentUser.uid).collection('accounts').orderBy('name').get();
        accounts = [];
        accountsSnapshot.forEach(doc => accounts.push({ id: doc.id, ...doc.data() }));

        selectedAccounts = new Set([...selectedAccounts].filter(id => accounts.some(account => account.id === id && account.currency === 'TRY')));
        if (selectedAccounts.size === 0 && accounts.some(account => account.currency === 'TRY')) {
            accounts.filter(account => account.currency === 'TRY').forEach(account => selectedAccounts.add(account.id));
            await db.collection('users').doc(currentUser.uid).set({ selectedAccounts: Array.from(selectedAccounts) }, { merge: true });
        }

        await processRecurringTransactions();
        const txSnapshot = await db.collection('users').doc(currentUser.uid).collection('transactions').orderBy('date', 'desc').get();
        transactions = [];
        txSnapshot.forEach(doc => transactions.push({ id: doc.id, ...doc.data() }));

        const trSnapshot = await db.collection('users').doc(currentUser.uid).collection('transfers').orderBy('date', 'desc').get();
        transfers = [];
        trSnapshot.forEach(doc => transfers.push({ id: doc.id, ...doc.data() }));

        try {
            const recurringSnapshot = await db.collection('users').doc(currentUser.uid).collection('recurringTransactions').get();
            recurringTransactions = [];
            recurringSnapshot.forEach(doc => recurringTransactions.push({ id: doc.id, ...doc.data() }));
        } catch (error) {
            if (error.code === 'permission-denied') {
                recurringTransactions = [];
                console.warn('Tekrarlayan işlemler için Firestore kuralı eksik.', error);
            } else {
                throw error;
            }
        }

        const goalsSnapshot = await db.collection('users').doc(currentUser.uid).collection('goals').orderBy('createdAt', 'desc').get();
        goals = [];
        goalsSnapshot.forEach(doc => goals.push({ id: doc.id, ...doc.data() }));

        await loadBudgets();
        await loadNotifications();
        updateAllUI();
        checkNotifications();
        updateNotificationsUI();
        if (typeof initPush === 'function') initPush();
    } catch (error) {
        console.error('Veri yükleme hatası:', error);
        if (error.code === 'permission-denied') showToast('Firestore kuralları hatalı. Lütfen kuralları kontrol edin.', 'error');
        else showToast('Veriler yüklenirken hata: ' + error.message, 'error');
    }

    async function processRecurringTransactions() {
        if (recurringProcessingPromise) return recurringProcessingPromise;
        recurringProcessingPromise = processRecurringTransactionsInternal();
        try {
            await recurringProcessingPromise;
        } finally {
            recurringProcessingPromise = null;
        }
    }

    async function processRecurringTransactionsInternal() {
        let snapshot;
        try {
            snapshot = await db.collection('users').doc(currentUser.uid).collection('recurringTransactions').get();
        } catch (error) {
            if (error.code === 'permission-denied') {
                console.warn('Tekrarlayan işlemler için Firestore izni verilmemiş.', error);
                return;
            }
            throw error;
        }
        const today = new Date().toISOString().split('T')[0];
        for (const document of snapshot.docs) {
            const recurring = { id: document.id, ...document.data() };
            let nextDate = recurring.nextDate;
            let createdCount = 0;
            while (recurring.active !== false && nextDate && nextDate <= today && createdCount < 120) {
                if (recurring.endDate && nextDate > recurring.endDate) {
                    await document.ref.update({ active: false });
                    break;
                }
                const account = accounts.find(item => item.id === recurring.accountId);
                if (!account) break;
                const amount = Number(recurring.amount);
                const isInstallment = Boolean(recurring.isInstallment);
                const installmentTotal = Number(recurring.installmentTotal || amount);
                const purchaseRate = Number(recurring.purchaseRate || 0);
                const transactionRate = isInvestmentAccount(account) ? Number(exchangeRates[account.currency] || getAccountOpeningRate(account)) : 0;
                const profitLoss = isInvestmentAccount(account) && transactionRate > 0 && purchaseRate > 0
                    ? (transactionRate - purchaseRate) * amount
                    : 0;
                const transactionRef = db.collection('users').doc(currentUser.uid).collection('transactions').doc(`${document.id}_${nextDate}`);
                const existingTransaction = await transactionRef.get();
                if (existingTransaction.exists) {
                    nextDate = getNextRecurringDate(nextDate, recurring.frequency);
                    createdCount++;
                    continue;
                }
                await transactionRef.set({
                    type: recurring.type, amount, category: recurring.category, description: recurring.description,
                    date: nextDate, accountId: account.id, accountName: account.name, accountCurrency: account.currency,
                    accountOpeningRate: getAccountOpeningRate(account), purchaseRate, transactionRate,
                    transactionRateDate: new Date().toISOString(), profitLoss, recurringId: document.id,
                    isInstallment,
                    installmentCount: Number(recurring.installmentCount || 1),
                    installmentInterestRate: Number(recurring.installmentInterestRate || 0),
                    installmentInterestAmount: Number(recurring.installmentInterestAmount || 0),
                    installmentTotal,
                    installmentAmount: Number(recurring.installmentAmount || amount),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                const balanceAmount = isInstallment && recurring.type === 'expense' ? installmentTotal : amount;
                const newBalance = recurring.type === 'income' ? Number(account.balance) + balanceAmount : Number(account.balance) - balanceAmount;
                const updates = { balance: newBalance };
                if (isInvestmentAccount(account)) {
                    updates.quantity = newBalance;
                    const oldRate = getAccountOpeningRate(account);
                    if (newBalance > 0 && purchaseRate > 0) {
                        updates.buyPrice = recurring.type === 'income'
                            ? ((Number(account.balance) * oldRate) + (amount * purchaseRate)) / newBalance
                            : ((Number(account.balance) * oldRate) - (amount * purchaseRate)) / newBalance;
                        updates.openingRate = updates.buyPrice;
                    }
                }
                await db.collection('users').doc(currentUser.uid).collection('accounts').doc(account.id).update(updates);
                Object.assign(account, updates);
                nextDate = getNextRecurringDate(nextDate, recurring.frequency);
                createdCount++;
            }
            if (nextDate) {
                await document.ref.update({ nextDate, active: recurring.active !== false && (!recurring.endDate || nextDate <= recurring.endDate) });
            }
        }
    }
}

function subscribeToPrivacyMode(userId) {
    if (privacyModeUnsubscribe) privacyModeUnsubscribe();

    privacyModeUnsubscribe = db.collection('users').doc(userId).onSnapshot((snapshot) => {
        if (!snapshot.exists || currentUser?.uid !== userId) return;
        setPrivacyModeUI(Boolean(snapshot.data().privacyModeEnabled));
    }, (error) => {
        console.error('Gizlilik modu dinleme hatası:', error);
    });
}

function setPrivacyModeUI(enabled) {
    isHidden = enabled;
    if (!enabled) totalBalanceVisible = false;

    const privacyButton = document.getElementById('privacyModeBtn');
    const balanceButton = document.getElementById('toggleBalanceBtn');
    if (privacyButton) privacyButton.innerHTML = enabled ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
    if (balanceButton) balanceButton.style.display = enabled ? 'block' : 'none';
    updateAllUI();
}

function updateAllUI() {
    updateAdminVisibility();
    updateAccountsUI();
    updateDashboard();
    updateTransactionsUI();
    updateRecurringTransactionsUI();
    updateGoalsUI();
    updateBudgetsUI();
    updateNotificationsUI();
    updateCharts();
    updateProfitLossReport();
    updateAdvancedReports();
    updateBalanceForecast();
    updateGoalAccountSelect();
    const monthDisplay = document.getElementById('currentMonthDisplay');
    if (monthDisplay) monthDisplay.textContent = formatMonth(currentMonth);
}

function updateAdminVisibility() {
    const link = document.getElementById('adminLink');
    if (link) link.style.display = isAdmin ? 'flex' : 'none';
    if (!isAdmin) {
        const adminPage = document.getElementById('admin');
        if (adminPage && adminPage.classList.contains('active')) {
            adminPage.classList.remove('active');
            document.getElementById('dashboard')?.classList.add('active');
        }
    }
}

function getTransactionValueTL(transaction) {
    const account = accounts.find(item => item.id === transaction.accountId);
    if (!isInvestmentAccount(account)) return Number(transaction.amount || 0);
    const rate = Number(transaction.transactionRate || exchangeRates[transaction.accountCurrency] || getAccountOpeningRate(account) || 0);
    return Number(transaction.amount || 0) * rate;
}

function updateBalanceForecast() {
    const startingEl = document.getElementById('forecastStartingBalance');
    const endingEl = document.getElementById('forecastEndingBalance');
    const balanceEl = document.getElementById('forecastBalance');
    const dateLabelEl = document.getElementById('forecastDateLabel');
    const eventsEl = document.getElementById('forecastEvents');
    if (!startingEl || !endingEl || !balanceEl || !dateLabelEl || !eventsEl) return;

    const selectedIds = new Set(accounts.filter(account => selectedAccounts.has(account.id) && account.currency === 'TRY').map(account => account.id));
    const startingBalance = accounts
        .filter(account => selectedIds.has(account.id))
        .reduce((sum, account) => sum + getAccountValueTL(account), 0);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 30);
    const todayKey = today.toISOString().split('T')[0];
    const endDateKey = endDate.toISOString().split('T')[0];
    const planned = [];

    const addPlanned = (date, type, amount, title, detail) => {
        if (!date || date <= todayKey || date > endDateKey || !(amount > 0)) return;
        planned.push({ date, type, amount, title, detail });
    };

    transactions.forEach(transaction => {
        if (selectedIds.has(transaction.accountId) && transaction.date > todayKey) {
            const amount = Number(transaction.isInstallment ? transaction.installmentAmount || transaction.amount : transaction.amount) || 0;
            addPlanned(transaction.date, transaction.type, amount, transaction.description || transaction.category || 'Planlanmış işlem', transaction.category || 'İleri tarihli işlem');
        }
        if (transaction.type === 'expense' && transaction.isInstallment && selectedIds.has(transaction.accountId)) {
            const count = Math.max(2, Number(transaction.installmentCount || 1));
            for (let index = 1; index < count; index++) {
                const date = calendarDateAddMonths(transaction.date, index);
                if (date > todayKey && date <= endDateKey) {
                    addPlanned(date, 'expense', Number(transaction.installmentAmount || (transaction.installmentTotal || transaction.amount) / count), transaction.description || transaction.category || 'Kredi kartı taksiti', `Taksit ${index + 1}/${count}`);
                }
            }
        }
    });

    recurringTransactions.filter(item => item.active !== false && selectedIds.has(item.accountId)).forEach(item => {
        let date = item.nextDate;
        let guard = 0;
        while (date && date <= endDateKey && guard++ < 120) {
            const amount = Number(item.isInstallment ? item.installmentAmount || item.amount : item.amount) || 0;
            addPlanned(date, item.type, amount, item.description || item.category || 'Tekrarlayan işlem', 'Tekrarlayan işlem');
            date = getNextRecurringDate(date, item.frequency);
        }
    });

    planned.sort((a, b) => a.date.localeCompare(b.date));
    const forecastBalance = startingBalance + planned.reduce((sum, event) => sum + (event.type === 'income' ? event.amount : -event.amount), 0);
    const formatAmount = value => isHidden ? '₺••••••' : `₺${value.toFixed(2)}`;
    const formatDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
    startingEl.textContent = formatAmount(startingBalance);
    endingEl.textContent = formatAmount(forecastBalance);
    balanceEl.textContent = formatAmount(forecastBalance);
    dateLabelEl.textContent = `${formatDate(endDateKey)} sonrası`;
    eventsEl.innerHTML = planned.length && !isHidden
        ? planned.map(event => `<div class="forecast-event ${event.type === 'income' ? 'income' : 'expense'}">
            <span class="forecast-event-date">${formatDate(event.date)}</span>
            <span class="forecast-event-icon"><i class="fas ${event.type === 'income' ? 'fa-arrow-down' : 'fa-arrow-up'}"></i></span>
            <span class="forecast-event-info"><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.detail)}</small></span>
            <b>${event.type === 'income' ? '+' : '-'}₺${event.amount.toFixed(2)}</b>
        </div>`).join('')
        : `<p class="empty-state">${isHidden ? 'Tahmin ayrıntıları gizli.' : 'Önümüzdeki 30 gün için planlanmış hareket yok.'}</p>`;
}

function signedReportValue(value) {
    const className = value >= 0 ? 'report-positive' : 'report-negative';
    return `<span class="${className}">${value >= 0 ? '+' : '-'}₺${Math.abs(value).toFixed(2)}</span>`;
}

function reportDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getReportRanges() {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    let start;
    let end;
    if (reportPeriod === 'month') {
        const [year, month] = currentMonth.split('-').map(Number);
        start = new Date(year, month - 1, 1, 12);
        end = new Date(year, month, 0, 12);
    } else if (reportPeriod === 'year') {
        start = new Date(today.getFullYear(), 0, 1, 12);
        end = new Date(today.getFullYear(), 11, 31, 12);
    } else if (reportPeriod === 'week') {
        start = new Date(today);
        const mondayOffset = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - mondayOffset);
        end = new Date(start);
        end.setDate(end.getDate() + 6);
    } else {
        start = new Date(today);
        end = new Date(today);
    }
    const length = Math.round((end - start) / 86400000) + 1;
    const previousEnd = new Date(start);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - length + 1);
    return {
        current: { start: reportDateKey(start), end: reportDateKey(end) },
        previous: { start: reportDateKey(previousStart), end: reportDateKey(previousEnd) }
    };
}

function reportTransactions(range, type) {
    return transactions.filter(transaction => {
        if (type && transaction.type !== type) return false;
        return transaction.date >= range.start && transaction.date <= range.end;
    });
}

function reportPeriodText(range) {
    const format = value => new Date(`${value}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    return reportPeriod === 'day' ? format(range.start)
        : `${format(range.start)} – ${format(range.end)}`;
}

function updateAdvancedReports() {
    const netWorthEl = document.getElementById('advancedNetWorth');
    const cashFlowEl = document.getElementById('advancedCashFlow');
    const profitLossEl = document.getElementById('advancedProfitLoss');
    const cashBody = document.getElementById('cashFlowReportBody');
    const categoryBody = document.getElementById('categoryComparisonBody');
    const distributionEl = document.getElementById('categoryDistribution');
    const accountBody = document.getElementById('accountComparisonBody');
    if (!netWorthEl || !cashFlowEl || !profitLossEl || !cashBody || !categoryBody) return;

    const netWorthSummary = getNetWorthSummary();
    const netWorth = netWorthSummary.assets - netWorthSummary.liabilities;
    const totalProfitLoss = accounts.filter(isInvestmentAccount).reduce((sum, account) => sum + getInvestmentMetrics(account).profitLoss, 0)
        + transactions.filter(transaction => transaction.type === 'expense').reduce((sum, transaction) => sum + Number(transaction.profitLoss || 0), 0);
    const ranges = getReportRanges();
    const currentTransactions = reportTransactions(ranges.current);
    const previousTransactions = reportTransactions(ranges.previous);
    const currentCashFlow = currentTransactions.reduce((sum, transaction) => sum + (transaction.type === 'income' ? 1 : -1) * getTransactionValueTL(transaction), 0);
    const previousCashFlow = previousTransactions.reduce((sum, transaction) => sum + (transaction.type === 'income' ? 1 : -1) * getTransactionValueTL(transaction), 0);
    netWorthEl.textContent = isHidden ? '₺••••••' : `₺${netWorth.toFixed(2)}`;
    cashFlowEl.innerHTML = isHidden ? '₺••••••' : signedReportValue(currentCashFlow);
    profitLossEl.innerHTML = isHidden ? '₺••••••' : signedReportValue(totalProfitLoss);
    const breakdownEl = document.getElementById('netWorthBreakdown');
    if (breakdownEl) {
        breakdownEl.innerHTML = isHidden
            ? '<span class="net-worth-hidden">Varlık ve borç ayrıntıları gizli.</span>'
            : `<div class="net-worth-metric"><span>Toplam varlık</span><strong>₺${netWorthSummary.assets.toFixed(2)}</strong></div>
               <div class="net-worth-metric liability"><span>Toplam borç</span><strong>₺${netWorthSummary.liabilities.toFixed(2)}</strong></div>
               <div class="net-worth-metric total"><span>Net varlık</span><strong>₺${netWorth.toFixed(2)}</strong></div>`;
    }
    const currentLabel = document.getElementById('reportCurrentLabel');
    const previousLabel = document.getElementById('reportPreviousLabel');
    const periodDescription = document.getElementById('reportPeriodDescription');
    const currentNetEl = document.getElementById('reportCurrentNet');
    const previousNetEl = document.getElementById('reportPreviousNet');
    const netChangeEl = document.getElementById('reportNetChange');
    if (currentLabel) currentLabel.textContent = `Bu dönem · ${reportPeriodText(ranges.current)}`;
    if (previousLabel) previousLabel.textContent = `Önceki dönem · ${reportPeriodText(ranges.previous)}`;
    if (periodDescription) periodDescription.textContent = `${reportPeriodText(ranges.current)} hareketleri`;
    if (currentNetEl) currentNetEl.innerHTML = isHidden ? '₺••••••' : signedReportValue(currentCashFlow);
    if (previousNetEl) previousNetEl.innerHTML = isHidden ? '₺••••••' : signedReportValue(previousCashFlow);
    if (netChangeEl) {
        const change = previousCashFlow !== 0 ? ((currentCashFlow - previousCashFlow) / Math.abs(previousCashFlow)) * 100 : (currentCashFlow ? 100 : 0);
        netChangeEl.innerHTML = isHidden ? '••••' : `<span class="${change >= 0 ? 'report-positive' : 'report-negative'}">${change >= 0 ? '+' : ''}${change.toFixed(1)}%</span>`;
    }

    const monthly = {};
    transactions.forEach(transaction => {
        const month = transaction.date?.substring(0, 7);
        if (!month) return;
        if (!monthly[month]) monthly[month] = { income: 0, expense: 0 };
        monthly[month][transaction.type] += getTransactionValueTL(transaction);
    });
    const months = Object.keys(monthly).sort().slice(-6).reverse();
    cashBody.innerHTML = months.length ? months.map(month => {
        const data = monthly[month];
        return `<tr><td>${formatMonth(month)}</td><td>₺${data.income.toFixed(2)}</td><td>₺${data.expense.toFixed(2)}</td><td>${signedReportValue(data.income - data.expense)}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty-state">Henüz nakit akışı verisi yok.</td></tr>';

    const categories = {};
    const categoryTotals = {};
    reportTransactions(ranges.current, 'expense').forEach(transaction => {
        const category = String(transaction.category || 'Diğer').replace(/^[^A-Za-zÇĞİÖŞÜçğıöşü0-9]+/u, '').trim() || 'Diğer';
        if (!categories[category]) categories[category] = { current: 0, previous: 0 };
        categories[category].current += getTransactionValueTL(transaction);
        categoryTotals[category] = (categoryTotals[category] || 0) + getTransactionValueTL(transaction);
    });
    reportTransactions(ranges.previous, 'expense').forEach(transaction => {
        const category = String(transaction.category || 'Diğer').replace(/^[^A-Za-zÇĞİÖŞÜçğıöşü0-9]+/u, '').trim() || 'Diğer';
        if (!categories[category]) categories[category] = { current: 0, previous: 0 };
        categories[category].previous += getTransactionValueTL(transaction);
    });
    const categoryRows = Object.entries(categories).sort((a, b) => b[1].current - a[1].current);
    categoryBody.innerHTML = categoryRows.length ? categoryRows.map(([category, values]) => {
        const change = values.current - values.previous;
        const hiddenValue = '<span class="report-hidden-value">₺••••••</span>';
        return `<tr><td>${escapeHtml(category)}</td><td>${isHidden ? hiddenValue : `₺${values.previous.toFixed(2)}`}</td><td>${isHidden ? hiddenValue : `₺${values.current.toFixed(2)}`}</td><td>${isHidden ? '••••' : signedReportValue(change)}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty-state">Karşılaştırılacak masraf verisi yok.</td></tr>';

    if (distributionEl) {
        const totalExpenses = Object.values(categoryTotals).reduce((sum, value) => sum + value, 0);
        const distributionRows = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
        distributionEl.innerHTML = !distributionRows.length || isHidden
            ? `<p class="empty-state">${isHidden ? 'Dağılım ayrıntıları gizli.' : 'Bu dönemde masraf verisi yok.'}</p>`
            : distributionRows.map(([category, value]) => {
                const percentage = totalExpenses ? (value / totalExpenses) * 100 : 0;
                return `<div class="distribution-row"><div><span>${escapeHtml(category)}</span><strong>₺${value.toFixed(2)}</strong></div><div class="distribution-track"><i style="width:${percentage.toFixed(1)}%"></i></div><small>%${percentage.toFixed(1)}</small></div>`;
            }).join('');
    }
    if (accountBody) {
        const rows = accounts.map(account => {
            const items = currentTransactions.filter(transaction => transaction.accountId === account.id);
            const income = items.filter(item => item.type === 'income').reduce((sum, item) => sum + getTransactionValueTL(item), 0);
            const expense = items.filter(item => item.type === 'expense').reduce((sum, item) => sum + getTransactionValueTL(item), 0);
            return { name: account.name || 'Adsız hesap', income, expense, net: income - expense };
        }).filter(row => row.income || row.expense).sort((a, b) => b.expense - a.expense);
        accountBody.innerHTML = rows.length && !isHidden
            ? rows.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>₺${row.income.toFixed(2)}</td><td>₺${row.expense.toFixed(2)}</td><td>${signedReportValue(row.net)}</td></tr>`).join('')
            : `<tr><td colspan="4" class="empty-state">${isHidden ? 'Hesap ayrıntıları gizli.' : 'Bu dönemde hesap hareketi yok.'}</td></tr>`;
    }
}

function updateGoalAccountSelect() {
    const select = document.getElementById('goalAccount');
    if (!select) return;
    const currentValue = select.value;
    const tryAccounts = accounts.filter(account => account.currency === 'TRY');
    select.innerHTML = '<option value="">Hesap bağlama</option>' +
        tryAccounts.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)} (${(Number(account.balance) || 0).toFixed(2)} ₺)</option>`).join('');
    if (tryAccounts.some(account => account.id === currentValue)) select.value = currentValue;
}

function updateRecurringTransactionsUI() {
    const list = document.getElementById('recurringTransactionsList');
    if (!list) return;
    const active = recurringTransactions.filter(item => item.active !== false);
    list.innerHTML = active.length ? active.map(item => `<div class="recurring-item">
        <span><strong>${item.type === 'income' ? 'Gelir' : 'Masraf'}</strong> · ${escapeHtml(item.description)} · ${Number(item.amount || 0).toFixed(2)} ${escapeHtml(item.accountCurrency)}</span>
        <small>Sonraki: ${escapeHtml(item.nextDate)}</small>
        <button class="delete-btn" onclick="cancelRecurringTransaction('${item.id}')"><i class="fas fa-stop"></i></button>
    </div>`).join('') : '<p class="empty-state">Aktif tekrarlayan işlem yok.</p>';
}

window.cancelRecurringTransaction = async function(id) {
    if (!currentUser || !confirm('Bu tekrarlayan işlemi durdurmak istiyor musunuz?')) return;
    await db.collection('users').doc(currentUser.uid).collection('recurringTransactions').doc(id).update({ active: false });
    showToast('Tekrarlayan işlem durduruldu.', 'success');
    await loadUserData();
};

function updateProfitLossReport() {
    const body = document.getElementById('profitLossReportBody');
    if (!body) return;
    const currencyLabels = { USD: '💵 Dolar', EUR: '💶 Euro', GRAM_ALTIN: '🪙 Gram Altın', CEYREK_ALTIN: '🪙 Çeyrek Altın' };
    const rows = investmentCurrencies.map(currency => {
        const currencyAccounts = accounts.filter(account => account.currency === currency);
        const metrics = currencyAccounts.reduce((totals, account) => {
            const value = getInvestmentMetrics(account);
            totals.quantity += value.quantity;
            totals.cost += value.cost;
            totals.currentValue += value.currentValue;
            return totals;
        }, { quantity: 0, cost: 0, currentValue: 0 });
        const realized = transactions
            .filter(transaction => transaction.type === 'expense' && transaction.accountCurrency === currency)
            .reduce((sum, transaction) => sum + Number(transaction.profitLoss || 0), 0);
        const unrealized = metrics.currentValue - metrics.cost;
        const total = unrealized + realized;
        if (!currencyAccounts.length && !realized) return '';
        const format = value => `₺${Math.abs(value).toFixed(2)}`;
        const signed = value => `<span class="${value >= 0 ? 'profit-loss-positive' : 'profit-loss-negative'}">${value >= 0 ? '+' : '-'}${format(value)}</span>`;
        return `<tr><td>${currencyLabels[currency]}</td><td>${metrics.quantity.toFixed(4)}</td><td>₺${metrics.cost.toFixed(2)}</td><td>₺${metrics.currentValue.toFixed(2)}</td><td>${signed(unrealized)}</td><td>${signed(realized)}</td><td>${signed(total)}</td></tr>`;
    }).join('');
    body.innerHTML = rows || '<tr><td colspan="7" class="empty-state">Henüz döviz veya altın kâr/zarar verisi yok.</td></tr>';
}

const investmentCurrencies = ['USD', 'EUR', 'GRAM_ALTIN', 'CEYREK_ALTIN'];

function isInvestmentAccount(account) {
    return Boolean(account && investmentCurrencies.includes(account.currency));
}

function getInvestmentMetrics(account) {
    const quantity = Number(account.quantity ?? account.balance ?? 0);
    const buyPrice = getAccountOpeningRate(account);
    const currentPrice = Number(exchangeRates[account.currency] || buyPrice);
    const cost = quantity * buyPrice;
    const currentValue = quantity * currentPrice;
    return { quantity, buyPrice, currentPrice, cost, currentValue, profitLoss: currentValue - cost };
}

function getAccountValueTL(account) {
    if (isInvestmentAccount(account)) return getInvestmentMetrics(account).currentValue;
    const balance = Number(account.balance || 0);
    if (account.currency === 'TRY') return balance;

    // Net varlık ve hesap dağılımı tüm hesapları TL karşılığıyla toplar.
    const rate = Number(exchangeRates[account.currency] || 0);
    return rate > 0 ? balance * rate : balance;
}

function getCreditCardMetrics(account) {
    const limit = Math.max(0, Number(account.creditLimit || 0));
    const debt = Math.max(0, Math.abs(Number(account.balance || 0)));
    return { limit, debt, available: Math.max(0, limit - debt), minimum: debt * (Number(account.minimumPaymentRate || 20) / 100) };
}

const liabilityAccountTypes = ['credit', 'debt'];

function getInstallmentMonthDifference(startDate, targetMonth) {
    const start = new Date(`${startDate}T12:00:00`);
    const target = new Date(`${targetMonth}-01T12:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) return null;
    return (target.getFullYear() - start.getFullYear()) * 12 + target.getMonth() - start.getMonth();
}

function getCurrentCreditCardInstallments() {
    return transactions.reduce((items, transaction) => {
        if (transaction.type !== 'expense' || !transaction.isInstallment) return items;
        const account = accounts.find(item => item.id === transaction.accountId);
        if (!account || account.type !== 'credit') return items;
        const count = Math.max(2, Number(transaction.installmentCount || 1));
        const monthDifference = getInstallmentMonthDifference(transaction.date, currentMonth);
        if (monthDifference === null || monthDifference < 0 || monthDifference >= count) return items;
        items.push({
            account,
            transaction,
            number: monthDifference + 1,
            count,
            amount: Number(transaction.installmentAmount || (transaction.installmentTotal || transaction.amount) / count)
        });
        return items;
    }, []);
}

function calendarDateAddMonths(dateString, months) {
    const source = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(source.getTime())) return '';
    const day = source.getDate();
    const result = new Date(source.getFullYear(), source.getMonth() + months, 1, 12);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, lastDay));
    return result.toISOString().split('T')[0];
}

function getCalendarEvents() {
    const [year, month] = currentMonth.split('-').map(Number);
    const monthStart = `${currentMonth}-01`;
    const monthEnd = new Date(year, month, 0, 12).toISOString().split('T')[0];
    const events = [];

    transactions.forEach(transaction => {
        if (transaction.date >= monthStart && transaction.date <= monthEnd) {
            events.push({ date: transaction.date, kind: 'current', type: transaction.type, amount: Number(transaction.amount) || 0,
                title: transaction.description || transaction.category || 'İşlem', detail: transaction.category || 'İşlem' });
        }
    });
    transfers.forEach(transfer => {
        if (transfer.date >= monthStart && transfer.date <= monthEnd) {
            events.push({ date: transfer.date, kind: 'current', type: 'transfer', amount: Number(transfer.amount) || 0,
                title: transfer.description || 'Hesaplar arası transfer', detail: 'Transfer' });
        }
    });
    recurringTransactions.filter(item => item.active !== false).forEach(item => {
        let date = item.nextDate;
        let guard = 0;
        while (date && date <= monthEnd && guard++ < 120) {
            if (date >= monthStart && (!item.endDate || date <= item.endDate)) {
                events.push({ date, kind: 'recurring', type: item.type, amount: Number(item.amount) || 0,
                    title: item.description || item.category || 'Tekrarlayan işlem', detail: 'Tekrarlayan ödeme' });
            }
            date = getNextRecurringDate(date, item.frequency);
        }
    });
    transactions.filter(item => item.type === 'expense' && item.isInstallment).forEach(transaction => {
        const count = Math.max(2, Number(transaction.installmentCount || 1));
        const start = new Date(`${transaction.date}T12:00:00`);
        for (let index = 0; index < count; index++) {
            const date = calendarDateAddMonths(transaction.date, index);
            if (date >= monthStart && date <= monthEnd) {
                events.push({ date, kind: 'installment', type: 'expense',
                    amount: Number(transaction.installmentAmount || (transaction.installmentTotal || transaction.amount) / count) || 0,
                    title: transaction.description || transaction.category || 'Kredi kartı taksiti',
                    detail: `Taksit ${index + 1}/${count}` });
            }
        }
    });
    return events;
}

function updateFinanceCalendar(selectedDate) {
    const calendar = document.getElementById('financeCalendar');
    const detail = document.getElementById('calendarDayItems');
    const selectedTitle = document.getElementById('calendarSelectedDate');
    if (!calendar || !detail || !selectedTitle) return;
    const [year, month] = currentMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const offset = (firstDay + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const events = getCalendarEvents();
    const grouped = events.reduce((result, event) => {
        (result[event.date] ||= []).push(event);
        return result;
    }, {});
    const weekdays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    let html = weekdays.map(day => `<div class="calendar-weekday" role="columnheader">${day}</div>`).join('');
    for (let index = 0; index < offset; index++) html += '<div class="calendar-cell is-empty" aria-hidden="true"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
        const date = `${currentMonth}-${String(day).padStart(2, '0')}`;
        const dayEvents = grouped[date] || [];
        const classes = [...new Set(dayEvents.map(event => event.kind))].join(' ');
        html += `<button type="button" class="calendar-cell ${classes} ${date === selectedDate ? 'selected' : ''}" data-calendar-date="${date}" role="gridcell" aria-label="${escapeHtml(date)} günü, ${dayEvents.length} kayıt">
            <strong>${day}</strong><span class="calendar-event-count">${dayEvents.length ? `${dayEvents.length} kayıt` : ''}</span>
            <span class="calendar-event-dots">${dayEvents.slice(0, 4).map(event => `<i class="calendar-dot ${event.kind}" title="${escapeHtml(event.detail)}"></i>`).join('')}</span>
        </button>`;
    }
    calendar.innerHTML = html;
    const today = new Date().toISOString().split('T')[0];
    if (!selectedDate || !selectedDate.startsWith(currentMonth)) selectedDate = today.startsWith(currentMonth) ? today : `${currentMonth}-01`;
    calendar.querySelectorAll('[data-calendar-date]').forEach(button => {
        button.classList.toggle('selected', button.dataset.calendarDate === selectedDate);
        button.addEventListener('click', () => updateFinanceCalendar(button.dataset.calendarDate));
    });
    selectedTitle.textContent = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    const selectedEvents = grouped[selectedDate] || [];
    detail.innerHTML = selectedEvents.length ? selectedEvents.map(event => {
        const sign = event.type === 'income' ? '+' : event.type === 'expense' ? '-' : '↔';
        const amount = isHidden ? '₺••••••' : `${sign}₺${event.amount.toFixed(2)}`;
        return `<div class="calendar-detail-item ${escapeHtml(event.kind)}"><i class="calendar-dot ${escapeHtml(event.kind)}"></i><span><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.detail)}</small></span><b>${amount}</b></div>`;
    }).join('') : '<p class="empty-state">Bu güne ait kayıt bulunmuyor.</p>';
}

function showInstallmentSummary() {
    const modal = document.getElementById('installmentSummaryModal');
    const list = document.getElementById('installmentSummaryList');
    if (!modal || !list) return;
    if (isHidden) {
        showToast('Taksit ayrıntılarını görmek için önce gizlilik modunu kapatın.', 'error');
        return;
    }
    const installments = getCurrentCreditCardInstallments();
    const grouped = installments.reduce((groups, item) => {
        if (!groups[item.account.id]) groups[item.account.id] = { account: item.account, items: [] };
        groups[item.account.id].items.push(item);
        return groups;
    }, {});
    list.innerHTML = Object.values(grouped).length
        ? Object.values(grouped).map(group => {
            const total = group.items.reduce((sum, item) => sum + item.amount, 0);
            return `<section class="installment-summary-account">
                <div class="installment-summary-account-header"><strong>💳 ${escapeHtml(group.account.name)}</strong><strong>₺${total.toFixed(2)}</strong></div>
                ${group.items.map(item => `<div class="installment-summary-item"><span>${escapeHtml(item.transaction.description || item.transaction.category)} · ${item.number}/${item.count}</span><strong>₺${item.amount.toFixed(2)}</strong></div>`).join('')}
            </section>`;
        }).join('')
        : '<p class="empty-state">Bu ay kredi kartlarına ait gelecek taksit bulunmuyor.</p>';
    modal.style.display = 'flex';
}

function getNetWorthSummary() {
    return accounts.reduce((summary, account) => {
        const value = getAccountValueTL(account);
        if (liabilityAccountTypes.includes(account.type)) {
            // Eski kredi kartı kayıtları borcu negatif saklar; pozitif girilmiş
            // yeni kayıtları da net varlıktan borç olarak düşür.
            summary.liabilities += Math.abs(value);
        } else {
            summary.assets += value;
        }
        return summary;
    }, { assets: 0, liabilities: 0 });
}

function updateEditAccountFields() {
    const currency = document.getElementById('editAccountCurrency').value;
    const isInvestment = investmentCurrencies.includes(currency);
    const typeSelect = document.getElementById('editAccountType');
    const balanceGroup = document.getElementById('editAccountBalanceGroup');
    const quantityInput = document.getElementById('editAccountQuantity');
    const buyPriceInput = document.getElementById('editAccountBuyPrice');
    const creditDetails = document.getElementById('editCreditCardDetails');
    const isCredit = document.getElementById('editAccountType').value === 'credit';

    document.getElementById('editInvestmentDetails').style.display = isInvestment ? 'block' : 'none';
    balanceGroup.style.display = isInvestment ? 'none' : 'block';
    if (creditDetails) {
        creditDetails.hidden = !isCredit;
        creditDetails.querySelectorAll('input').forEach(input => { input.required = isCredit; });
    }
    quantityInput.required = isInvestment;
    buyPriceInput.required = isInvestment;
    typeSelect.disabled = isInvestment;
    if (isInvestment) typeSelect.value = 'investment';
    else if (typeSelect.value === 'investment') typeSelect.value = 'bank';
}

function updateDashboard() {
    const selectedAccountsList = accounts.filter(a => selectedAccounts.has(a.id) && a.currency === 'TRY');
    const totalBalance = selectedAccountsList.reduce((sum, a) => sum + getAccountValueTL(a), 0);

    const totalIncome = transactions.filter(t => t.type === 'income' && String(t.date || '').startsWith(currentMonth)).reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalExpense = transactions.filter(t => t.type === 'expense' && String(t.date || '').startsWith(currentMonth)).reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome * 100) : 0;
    const netBalance = totalIncome - totalExpense;
    const accountCount = accounts.length;
    const upcomingInstallments = getCurrentCreditCardInstallments().reduce((sum, item) => sum + item.amount, 0);

    const investmentAccounts = accounts.filter(isInvestmentAccount);
    const investmentTotals = investmentAccounts.reduce((totals, account) => {
        const metrics = getInvestmentMetrics(account);
        totals.currentValue += metrics.currentValue;
        totals.profitLoss += metrics.profitLoss;
        return totals;
    }, { currentValue: 0, profitLoss: 0 });
    const realizedProfitLoss = transactions
        .filter(transaction => isInvestmentAccount(accounts.find(account => account.id === transaction.accountId)))
        .filter(transaction => transaction.type === 'expense')
        .reduce((sum, transaction) => sum + Number(transaction.profitLoss || 0), 0);
    investmentTotals.profitLoss += realizedProfitLoss;

    const totalBalanceEl = document.getElementById('totalBalance');
    const totalIncomeEl = document.getElementById('totalIncome');
    const totalExpenseEl = document.getElementById('totalExpense');
    const savingsRateEl = document.getElementById('savingsRate');
    const investmentSummaryEl = document.getElementById('investmentSummary');
    const investmentProfitLossEl = document.getElementById('investmentProfitLoss');
    const upcomingInstallmentsEl = document.getElementById('upcomingInstallments');
    const statNetEl = document.getElementById('statNet');
    const statAccountCountEl = document.getElementById('statAccountCount');
    const monthDisplay = document.getElementById('currentMonthDisplay');

    if (isHidden) {
        if (totalBalanceEl) totalBalanceEl.textContent = totalBalanceVisible ? `₺${totalBalance.toFixed(2)}` : '₺••••••';
        if (totalIncomeEl) totalIncomeEl.textContent = '₺••••••';
        if (totalExpenseEl) totalExpenseEl.textContent = '₺••••••';
        if (savingsRateEl) savingsRateEl.textContent = '%••••';
        if (investmentSummaryEl) investmentSummaryEl.textContent = '₺••••••';
        if (investmentProfitLossEl) investmentProfitLossEl.textContent = 'Kâr/Zarar: ₺••••••';
        if (upcomingInstallmentsEl) upcomingInstallmentsEl.textContent = '₺••••••';
        if (statNetEl) statNetEl.textContent = '₺••••••';
        if (statAccountCountEl) statAccountCountEl.textContent = '••';
    } else {
        if (totalBalanceEl) totalBalanceEl.textContent = `₺${totalBalance.toFixed(2)}`;
        if (totalIncomeEl) totalIncomeEl.textContent = `₺${totalIncome.toFixed(2)}`;
        if (totalExpenseEl) totalExpenseEl.textContent = `₺${totalExpense.toFixed(2)}`;
        if (savingsRateEl) savingsRateEl.textContent = `%${savingsRate.toFixed(1)}`;
        if (investmentSummaryEl) investmentSummaryEl.textContent = `₺${investmentTotals.currentValue.toFixed(2)}`;
        if (investmentProfitLossEl) {
            const sign = investmentTotals.profitLoss >= 0 ? '+' : '-';
            investmentProfitLossEl.textContent = `Kâr/Zarar: ${sign}₺${Math.abs(investmentTotals.profitLoss).toFixed(2)}`;
            investmentProfitLossEl.classList.toggle('profit', investmentTotals.profitLoss >= 0);
            investmentProfitLossEl.classList.toggle('loss', investmentTotals.profitLoss < 0);
        }
        if (upcomingInstallmentsEl) upcomingInstallmentsEl.textContent = `₺${upcomingInstallments.toFixed(2)}`;
        if (statNetEl) {
            statNetEl.textContent = `${netBalance >= 0 ? '+' : '-'}₺${Math.abs(netBalance).toFixed(2)}`;
            statNetEl.classList.toggle('profit', netBalance >= 0);
            statNetEl.classList.toggle('loss', netBalance < 0);
        }
        if (statAccountCountEl) statAccountCountEl.textContent = String(accountCount);
    }

    if (monthDisplay) monthDisplay.textContent = formatMonth(currentMonth);
    updateFinanceCalendar();

    const eyeBtn = document.getElementById('toggleBalanceBtn');
    if (eyeBtn) {
        eyeBtn.style.display = isHidden ? 'block' : 'none';
    }
}

function showAccountSummary() {
    // Gizlilik modunda özet gösterme
    if (isHidden) {
        return;
    }
    const modal = document.getElementById('accountSummaryModal');
    const list = document.getElementById('accountSummaryList');
    if (!modal || !list) return;
    const selectedAccountsList = accounts.filter(a => selectedAccounts.has(a.id) && a.currency === 'TRY');
    if (selectedAccountsList.length === 0) list.innerHTML = '<p class="empty-state">Gösterilecek hesap seçilmedi.</p>';
    else list.innerHTML = selectedAccountsList.map(account => `<div class="account-summary-item"><span>${escapeHtml(account.name)}</span><strong>₺${getAccountValueTL(account).toFixed(2)}</strong></div>`).join('');
    modal.style.display = 'flex';
}

function updateAccountsUI() {
    const accountsList = document.getElementById('accountsList');
    const accountSelect = document.getElementById('accountSelect');
    const fromAccount = document.getElementById('fromAccount');
    const toAccount = document.getElementById('toAccount');
    const filterAccount = document.getElementById('filterAccount');
    const accountSelector = document.getElementById('accountSelector');

    const currencySymbols = { TRY: '₺', USD: '$', EUR: '€', GRAM_ALTIN: '🪙', CEYREK_ALTIN: '🪙' };
    const typeIcons = { bank: '🏦', cash: '💵', credit: '💳', ewallet: '📱', investment: '📈', crypto: '₿', debt: '🤝' };

    if (accountsList) {
        if (accounts.length === 0) accountsList.innerHTML = '<p class="empty-state">Henüz hesap eklenmemiş</p>';
        else {
            accountsList.innerHTML = accounts.map(account => {
                const investment = isInvestmentAccount(account);
                const metrics = investment ? getInvestmentMetrics(account) : null;
                const credit = account.type === 'credit' ? getCreditCardMetrics(account) : null;
                const balance = Number(account.balance) || 0;
                const isNegative = investment ? metrics.profitLoss < 0 : account.type === 'credit' ? credit.debt > 0 : balance < 0;
                const balanceDisplay = isHidden ? '₺••••••' : investment
                    ? `₺${metrics.currentValue.toFixed(2)}`
                    : credit ? `₺${credit.debt.toFixed(2)}`
                    : `${currencySymbols[account.currency] || '₺'} ${balance.toFixed(2)}`;
                const investmentDetail = investment && !isHidden
                    ? `<p class="investment-account-detail">${metrics.quantity} adet · Maliyet: ₺${metrics.cost.toFixed(2)} · ${metrics.profitLoss >= 0 ? 'Kâr' : 'Zarar'}: ${metrics.profitLoss >= 0 ? '+' : '-'}₺${Math.abs(metrics.profitLoss).toFixed(2)}</p>`
                    : '';
                const creditDetail = credit && !isHidden
                    ? `<div class="credit-account-metrics"><span><b>₺${credit.debt.toFixed(2)}</b><small>Kullanılan limit / borç</small></span><span><b>₺${credit.available.toFixed(2)}</b><small>Kullanılabilir limit</small></span><span><b>₺${credit.minimum.toFixed(2)}</b><small>Asgari ödeme</small></span></div>
                       <div class="credit-progress"><i style="width:${credit.limit ? Math.min(100, credit.debt / credit.limit * 100) : 0}%"></i></div>`
                    : '';
                const accountColor = /^#[0-9a-f]{6}$/i.test(account.color || '') ? account.color : '#4CAF50';
                const accountLabel = account.label ? `<span class="account-label" style="--account-color:${accountColor}">${escapeHtml(account.label)}</span>` : '';
                return `<div class="account-card" style="--account-color:${accountColor}; border-top: 4px solid var(--account-color);">
                    <div class="account-card-header">
                        <div class="account-card-type ${account.type}">${typeIcons[account.type] || '💰'}</div>
                        <div>
                            <button class="edit-account-btn" onclick="editAccount('${account.id}')" title="Hesabı Düzenle"><i class="fas fa-edit"></i></button>
                            <button class="delete-account-btn" onclick="deleteAccount('${account.id}')" title="Hesabı Sil"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <h3 class="account-card-title"><span>${escapeHtml(account.name)}</span>${accountLabel}</h3>
                    <p class="account-card-balance ${isNegative ? 'negative-balance' : ''}">${balanceDisplay}</p>
                    ${investmentDetail}
                    ${creditDetail}
                </div>`;
            }).join('');
        }
    }

    const accountOptions = accounts.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.currency)})</option>`).join('');
    if (accountSelect) {
        accountSelect.innerHTML = '<option value="">Hesap Seçin</option>' + accountOptions;
        accountSelect.onchange = () => {
            updateAccountRateInfo();
            updateTransactionPurchaseFields();
        };
    }
    if (fromAccount) fromAccount.innerHTML = '<option value="">Hesap Seçin</option>' + accountOptions;
    if (toAccount) toAccount.innerHTML = '<option value="">Hesap Seçin</option>' + accountOptions;
    if (filterAccount) filterAccount.innerHTML = '<option value="all">Tüm Hesaplar</option>' + accountOptions;
    updateAccountRateInfo();
    updateTransactionPurchaseFields();

    if (accountSelector) {
        if (accounts.length === 0) accountSelector.innerHTML = '<p class="empty-state">Hesap ekleyin</p>';
        else {
            const tryAccounts = accounts.filter(account => account.currency === 'TRY');
            if (tryAccounts.length === 0) {
                accountSelector.innerHTML = '<p class="empty-state">Gösterilecek TL hesabı bulunmuyor.</p>';
                return;
            }
            accountSelector.innerHTML = tryAccounts.map(account => {
                const isChecked = selectedAccounts.has(account.id);
                return `<label class="account-checkbox ${isChecked ? 'checked' : ''}">
                    <input type="checkbox" value="${escapeHtml(account.id)}" ${isChecked ? 'checked' : ''} onchange="window.toggleAccountSelection('${escapeHtml(account.id)}', this.checked)">
                    <span class="checkmark"><i class="fas fa-check"></i></span>
                    <span>${escapeHtml(account.name)}</span>
                </label>`;
            }).join('');
        }
    }
}

window.editAccount = function(id) {
    const account = accounts.find(a => a.id === id);
    if (!account || !currentUser) return;
    if (isHidden) {
        showToast('Hesap bilgilerini düzenlemek için önce gizlilik modunu kapatın.', 'error');
        return;
    }
    const investment = isInvestmentAccount(account);
    document.getElementById('editAccountId').value = account.id;
    document.getElementById('editAccountName').value = account.name;
    document.getElementById('editAccountType').value = investment ? 'investment' : account.type;
    document.getElementById('editAccountCurrency').value = account.currency;
    document.getElementById('editAccountBalance').value = investment ? '' : account.balance;
    document.getElementById('editAccountQuantity').value = investment ? getInvestmentMetrics(account).quantity : '';
    document.getElementById('editAccountBuyPrice').value = investment ? account.buyPrice || '' : '';
    document.getElementById('editAccountLabel').value = account.label || '';
    document.getElementById('editAccountColor').value = /^#[0-9a-f]{6}$/i.test(account.color || '') ? account.color : '#4CAF50';
    document.getElementById('editAccountCreditLimit').value = account.creditLimit || '';
    document.getElementById('editAccountStatementDay').value = account.statementDay || '';
    document.getElementById('editAccountDueDay').value = account.dueDay || '';
    document.getElementById('editAccountMinimumPaymentRate').value = account.minimumPaymentRate || 20;
    updateEditAccountFields();
    document.getElementById('editAccountModal').style.display = 'flex';
};

window.toggleAccountSelection = async function(accountId, isChecked) {
    if (isChecked) selectedAccounts.add(accountId);
    else selectedAccounts.delete(accountId);
    updateAccountsUI();
    updateDashboard();
    if (currentUser) await db.collection('users').doc(currentUser.uid).set({ selectedAccounts: Array.from(selectedAccounts) }, { merge: true });
};

function updateTransactionsUI() {
    const recentList = document.getElementById('recentTransactionsList');
    const allList = document.getElementById('allTransactionsList');
    if (!recentList && !allList) return;

    const allItems = [];
    const recurringDateKeys = new Set();
    transactions.forEach(t => {
        const recurringDateKey = t.recurringId ? `${t.recurringId}|${t.date || ''}` : '';
        if (recurringDateKey && recurringDateKeys.has(recurringDateKey)) return;
        if (recurringDateKey) recurringDateKeys.add(recurringDateKey);
        allItems.push({
            id: t.id,
            isTransfer: false,
            displayType: t.type,
            amount: t.amount,
            category: t.category || 'İşlem',
            description: t.description || '',
            date: t.date || '',
            accountName: t.accountName || '',
            accountCurrency: t.accountCurrency || 'TRY',
            accountId: t.accountId,
            accountOpeningRate: Number(t.accountOpeningRate || 0),
            purchaseRate: Number(t.purchaseRate || t.accountOpeningRate || 0),
            transactionRate: Number(t.transactionRate || 0),
            profitLoss: Number(t.profitLoss || 0)
            ,isInstallment: Boolean(t.isInstallment), installmentCount: Number(t.installmentCount || 1),
            installmentAmount: Number(t.installmentAmount || 0),
            installmentInterestRate: Number(t.installmentInterestRate || 0),
            installmentInterestAmount: Number(t.installmentInterestAmount || 0),
            installmentTotal: Number(t.installmentTotal || t.amount || 0)
        });
    });

    transfers.forEach(t => {
        allItems.push({
            id: t.id,
            isTransfer: true,
            displayType: 'transfer',
            amount: t.amount,
            category: '🔄 Transfer',
            description: `${t.fromAccountName} → ${t.toAccountName}${t.description ? ' - ' + t.description : ''}`,
            date: t.date || '',
            accountName: t.fromAccountName,
            accountCurrency: 'TRY',
            accountOpeningRate: 0,
            transactionRate: 0,
            profitLoss: 0,
            fromAccountId: t.fromAccountId,
            toAccountId: t.toAccountId
        });
    });

    allItems.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const createCard = (item) => {
        const isExpense = item.displayType === 'expense';
        const isTransfer = item.displayType === 'transfer';
        const icon = isExpense ? 'fa-arrow-up' : isTransfer ? 'fa-exchange-alt' : 'fa-arrow-down';
        const sign = isExpense ? '-' : isTransfer ? '↔' : '+';
        const amountClass = isExpense ? 'expense' : isTransfer ? 'transfer' : 'income';
        const currencySymbol = item.accountCurrency === 'USD' ? '$' : item.accountCurrency === 'EUR' ? '€' : item.accountCurrency === 'GRAM_ALTIN' || item.accountCurrency === 'CEYREK_ALTIN' ? '🪙' : '₺';
        const amount = Number(item.amount) || 0;
        const amountDisplay = isHidden ? '₺••••••' : `${sign}${currencySymbol}${amount.toFixed(2)}`;
         const purchaseRateDisplay = !isTransfer && item.purchaseRate > 0
            ? `<div class="transaction-rate-modern">Alış kuru: ${getCurrencyRateLabel(item.accountCurrency, item.purchaseRate)}</div>`
            : '';
        const transactionRateDisplay = !isTransfer && item.transactionRate > 0
            ? `<div class="transaction-rate-modern">İşlem kuru: ${getCurrencyRateLabel(item.accountCurrency, item.transactionRate)}</div>`
            : '';
        const profitLossDisplay = !isTransfer && item.profitLoss !== 0
            ? `<div class="transaction-rate-modern">${item.profitLoss > 0 ? 'Kâr' : 'Zarar'}: ${item.profitLoss > 0 ? '+' : '-'}₺${Math.abs(item.profitLoss).toFixed(2)}</div>`
            : '';
        const installmentDisplay = !isTransfer && item.isInstallment
            ? `<div class="transaction-rate-modern"><i class="fas fa-credit-card"></i> ${item.installmentCount} taksit · Faiz: %${item.installmentInterestRate.toFixed(2)} · Aylık ₺${item.installmentAmount.toFixed(2)} · Toplam ₺${item.installmentTotal.toFixed(2)} · Sonraki: ${new Date(new Date(`${item.date}T12:00:00`).setMonth(new Date(`${item.date}T12:00:00`).getMonth() + 1)).toLocaleDateString('tr-TR')}</div>`
            : '';

        let deleteBtn = '';
        if (item.isTransfer) deleteBtn = `<button class="delete-btn" onclick="deleteTransfer('${item.id}')"><i class="fas fa-trash"></i></button>`;
        else deleteBtn = `<div class="transaction-actions"><button class="edit-transaction-btn" onclick="editTransaction('${item.id}')" title="İşlemi düzenle"><i class="fas fa-edit"></i></button><button class="delete-btn" onclick="deleteTransaction('${item.id}')" title="İşlemi sil"><i class="fas fa-trash"></i></button></div>`;

        return `<div class="transaction-card-modern">
            <div class="transaction-icon-modern ${amountClass}"><i class="fas ${icon}"></i></div>
            <div class="transaction-info-modern">
                <div class="transaction-title-modern">${escapeHtml(item.category)}</div>
                <div class="transaction-subtitle-modern">${escapeHtml(item.description)} • ${escapeHtml(item.date)}${purchaseRateDisplay}${transactionRateDisplay}${profitLossDisplay}${installmentDisplay}</div>
            </div>
            <div class="transaction-amount-modern ${amountClass}">${amountDisplay}</div>
            ${deleteBtn}
        </div>`;
    };

    if (recentList) recentList.innerHTML = allItems.length === 0 ? '<p class="empty-state">Henüz işlem yok</p>' : allItems.slice(0, 5).map(createCard).join('');
    if (allList) {
        const filterType = document.getElementById('filterType')?.value || 'all';
        const filterAccount = document.getElementById('filterAccount')?.value || 'all';
        let filtered = allItems;
        if (filterType === 'income') filtered = filtered.filter(t => t.displayType === 'income');
        if (filterType === 'expense') filtered = filtered.filter(t => t.displayType === 'expense');
        if (filterType === 'transfer') filtered = filtered.filter(t => t.displayType === 'transfer');
        if (filterAccount !== 'all') filtered = filtered.filter(t => t.accountId === filterAccount || t.fromAccountId === filterAccount);
        allList.innerHTML = filtered.length === 0 ? '<p class="empty-state">Bu filtrede işlem bulunamadı</p>' : filtered.map(createCard).join('');
    }

    window.editTransaction = function(id) {
        const transaction = transactions.find(item => item.id === id);
        if (!transaction || !currentUser || isHidden) {
            if (isHidden) showToast('İşlemi düzenlemek için önce gizlilik modunu kapatın.', 'error');
            return;
        }
        const recurring = recurringTransactions.find(item => item.id === transaction.recurringId)
            || recurringTransactions.find(item => item.accountId === transaction.accountId
                && item.description === transaction.description
                && Number(item.amount) === Number(transaction.amount));
        editingTransactionId = id;
        selectedType = transaction.type === 'income' ? 'income' : 'expense';
        const typeButton = document.querySelector(`.type-btn[data-type="${selectedType}"]`);
        if (typeButton) typeButton.click();
        document.getElementById('accountSelect').value = transaction.accountId;
        document.getElementById('category').value = transaction.category || '';
        document.getElementById('amount').value = transaction.amount || '';
        document.getElementById('description').value = transaction.description || '';
        document.getElementById('date').value = transaction.date || '';
        document.getElementById('transactionPurchaseRate').value = transaction.purchaseRate || '';
        document.getElementById('isInstallment').checked = Boolean(transaction.isInstallment);
        document.getElementById('installmentOptions').hidden = !transaction.isInstallment;
        document.getElementById('installmentCount').value = transaction.installmentCount || 2;
        document.getElementById('installmentInterestRate').value = transaction.installmentInterestRate || 0;
        const hasRecurringSettings = Boolean(recurring || transaction.isRecurringSource);
        document.getElementById('isRecurring').checked = hasRecurringSettings;
        document.getElementById('recurringOptions').hidden = !hasRecurringSettings;
        if (hasRecurringSettings) {
            document.getElementById('recurringFrequency').value = recurring?.frequency || 'monthly';
            document.getElementById('recurringEndDate').value = recurring?.endDate || '';
        }
        updateTransactionPurchaseFields();
        const submitButton = document.getElementById('transactionSubmitBtn');
        if (submitButton) submitButton.innerHTML = '<i class="fas fa-save"></i> Değişiklikleri Kaydet';
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.getElementById('add-transaction').classList.add('active');
        document.querySelectorAll('.sidebar-link').forEach(link => link.classList.toggle('active', link.dataset.page === 'transactions'));
    };
}

function updateGoalsUI() {
    const goalsList = document.getElementById('goalsList');
    if (!goalsList) return;
    if (goals.length === 0) { goalsList.innerHTML = '<p class="empty-state">Henüz hedef eklenmemiş</p>'; return; }
    goalsList.innerHTML = goals.map(goal => {
        const progress = goal.amount > 0 ? (goal.current / goal.amount) * 100 : 0;
        const percentage = Math.min(progress, 100).toFixed(1);
        const currentDisplay = isHidden ? '₺••••••' : `₺${(goal.current || 0).toFixed(2)}`;
        const targetDisplay = isHidden ? '₺••••••' : `₺${(goal.amount || 0).toFixed(2)}`;
        const linkedAccount = goal.accountName ? `<small class="goal-linked-account"><i class="fas fa-link"></i> ${escapeHtml(goal.accountName)}</small>` : '';
        return `<div class="goal-card">
            <div class="goal-card-header"><div><h3>${escapeHtml(goal.name)}</h3>${linkedAccount}</div><button class="delete-goal-btn" onclick="deleteGoal('${escapeHtml(goal.id)}')"><i class="fas fa-trash"></i></button></div>
            <div class="goal-progress-bar"><div class="goal-progress-fill" style="width: ${percentage}%;"></div></div>
            <div class="goal-amounts"><span>${currentDisplay}</span><span class="goal-percentage">%${percentage}</span><span>${targetDisplay}</span></div>
            <button class="add-btn" style="margin-top:10px; width:100%; justify-content:center;" onclick="addToGoal('${escapeHtml(goal.id)}')"><i class="fas fa-plus"></i> Para Ekle</button>
        </div>`;
    }).join('');
}

window.addToGoal = async function(goalId) {
    const goal = goals.find(g => g.id === goalId);
    if (!goal || !currentUser) return;
    const amountInput = await requestModernInput({
        title: 'Hedefe para ekle',
        description: `"${goal.name}" hedefinize eklemek istediğiniz tutarı girin.`,
        label: 'Eklenecek tutar (₺)',
        icon: 'fa-bullseye',
        type: 'number',
        inputMode: 'decimal',
        min: '0.01',
        step: '0.01',
        placeholder: '0,00'
    });
    const amount = parseFloat((amountInput || '').replace(',', '.'));
    if (!amount || amount <= 0) return;
    const newCurrent = (goal.current || 0) + amount;
    const linkedAccount = goal.accountId ? accounts.find(account => account.id === goal.accountId) : null;
    if (linkedAccount && Number(linkedAccount.balance || 0) < amount) {
        showToast('Bağlı hesapta yeterli bakiye yok.', 'error');
        return;
    }
    try {
        const batch = db.batch();
        batch.update(db.collection('users').doc(currentUser.uid).collection('goals').doc(goalId), { current: newCurrent });
        if (linkedAccount) {
            batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(linkedAccount.id), { balance: Number(linkedAccount.balance || 0) - amount });
        }
        await batch.commit();
        showToast('Hedefe para eklendi!', 'success');
        await loadUserData();
    } catch (error) { showToast('Hata: ' + error.message, 'error'); }
};

function requestModernInput({ title, description, label, icon = 'fa-pen', type = 'text', inputMode = 'text', min, step, placeholder, autocomplete = 'off' }) {
    return new Promise(resolve => {
        const modal = document.getElementById('modernInputModal');
        const form = document.getElementById('modernInputForm');
        const input = document.getElementById('modernInputField');
        const error = document.getElementById('modernInputError');
        const iconElement = document.getElementById('modernInputIcon');
        if (!modal || !form || !input || !error || !iconElement) { resolve(null); return; }

        document.getElementById('modernInputTitle').textContent = title;
        document.getElementById('modernInputDescription').textContent = description;
        document.getElementById('modernInputLabel').textContent = label;
        iconElement.className = `fas ${icon}`;
        input.type = type;
        input.inputMode = inputMode;
        input.autocomplete = autocomplete;
        input.min = min || '';
        input.step = step || '';
        input.placeholder = placeholder || '';
        input.value = '';
        error.textContent = '';
        document.getElementById('toggleModernInputVisibility').style.display = type === 'password' ? 'block' : 'none';
        modal.style.display = 'flex';

        const close = value => {
            modal.style.display = 'none';
            form.removeEventListener('submit', submit);
            document.getElementById('cancelModernInput').removeEventListener('click', cancel);
            document.getElementById('toggleModernInputVisibility').removeEventListener('click', toggleVisibility);
            input.removeEventListener('keydown', handleKeydown);
            resolve(value);
        };
        const submit = event => {
            event.preventDefault();
            if (!input.value.trim() || (type === 'number' && Number(input.value) <= 0)) {
                error.textContent = type === 'number' ? 'Sıfırdan büyük bir tutar girin.' : 'Bu alan zorunludur.';
                input.focus();
                return;
            }
            close(input.value.trim());
        };
        const cancel = () => close(null);
        const toggleVisibility = () => {
            input.type = input.type === 'password' ? 'text' : 'password';
            document.querySelector('#toggleModernInputVisibility i').className = input.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
        };
        const handleKeydown = event => { if (event.key === 'Escape') cancel(); };
        form.addEventListener('submit', submit);
        document.getElementById('cancelModernInput').addEventListener('click', cancel);
        document.getElementById('toggleModernInputVisibility').addEventListener('click', toggleVisibility);
        input.addEventListener('keydown', handleKeydown);
        requestAnimationFrame(() => input.focus());
    });
}

window.deleteGoal = async function(id) {
    if (!confirm('Bu hedefi silmek istediğinize emin misiniz?')) return;
    if (!currentUser) return;
    try { await db.collection('users').doc(currentUser.uid).collection('goals').doc(id).delete(); showToast('Hedef silindi!', 'success'); await loadUserData(); } catch (e) { showToast('Silme hatası: ' + e.message, 'error'); }
};

window.deleteAccount = async function(id) {
    if (!confirm('Bu hesabı silmek istediğinize emin misiniz?')) return;
    if (!currentUser) return;
    try { await db.collection('users').doc(currentUser.uid).collection('accounts').doc(id).delete(); showToast('Hesap silindi!', 'success'); await loadUserData(); } catch (e) { showToast('Silme hatası: ' + e.message, 'error'); }
};

window.deleteTransaction = async function(id) {
    if (!confirm('Bu işlemi silmek istediğinize emin misiniz?')) return;
    if (!currentUser) return;
    try {
        const transaction = transactions.find(t => t.id === id);
        if (transaction) {
            const account = accounts.find(a => a.id === transaction.accountId);
            const batch = db.batch();
            if (account) {
                // Taksitli işlem hesabı toplam tutarla etkiler; yalnızca anapara
                // ile geri almak hesabı eksik bırakıyordu.
                const impact = transaction.type === 'income'
                    ? Number(transaction.amount || 0)
                    : Number(transaction.isInstallment
                        ? (transaction.installmentTotal || transaction.amount)
                        : transaction.amount || 0);
                const newBalance = transaction.type === 'income'
                    ? Number(account.balance || 0) - impact
                    : Number(account.balance || 0) + impact;
                const updates = { balance: newBalance };
                if (isInvestmentAccount(account)) {
                    updates.quantity = newBalance;
                    const transactionRate = Number(transaction.purchaseRate || transaction.accountOpeningRate || 0);
                    const currentRate = getAccountOpeningRate(account);
                    if (transactionRate > 0 && newBalance > 0) {
                        if (transaction.type === 'income') {
                            updates.buyPrice = ((Number(account.balance) * currentRate) - (impact * transactionRate)) / newBalance;
                        } else {
                            updates.buyPrice = ((Number(account.balance) * currentRate) + (impact * transactionRate)) / newBalance;
                        }
                        updates.openingRate = updates.buyPrice;
                    }
                }
                batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(account.id), updates);
            }
            batch.delete(db.collection('users').doc(currentUser.uid).collection('transactions').doc(id));
            if (transaction.isRecurringSource && transaction.recurringId) {
                batch.delete(db.collection('users').doc(currentUser.uid).collection('recurringTransactions').doc(transaction.recurringId));
            }
            await batch.commit();
        }
        showToast('İşlem silindi!', 'success');
        await loadUserData();
    } catch (e) { showToast('Silme hatası: ' + e.message, 'error'); }
};

window.deleteTransfer = async function(id) {
    if (!confirm('Bu transferi silmek istediğinize emin misiniz?')) return;
    if (!currentUser) return;
    try {
        const transfer = transfers.find(t => t.id === id);
        if (transfer) {
            const fromAccount = accounts.find(a => a.id === transfer.fromAccountId);
            const toAccount = accounts.find(a => a.id === transfer.toAccountId);
            const batch = db.batch();
            const amount = Number(transfer.amount || 0);
            if (fromAccount) batch.update(
                db.collection('users').doc(currentUser.uid).collection('accounts').doc(fromAccount.id),
                { balance: Number(fromAccount.balance || 0) + amount }
            );
            if (toAccount) batch.update(
                db.collection('users').doc(currentUser.uid).collection('accounts').doc(toAccount.id),
                { balance: Number(toAccount.balance || 0) - amount }
            );
            batch.delete(db.collection('users').doc(currentUser.uid).collection('transfers').doc(id));
            const linkedPayment = transactions.find(item => item.transferId === id);
            if (linkedPayment) {
                batch.delete(db.collection('users').doc(currentUser.uid).collection('transactions').doc(linkedPayment.id));
            }
            await batch.commit();
        }
        showToast('Transfer silindi!', 'success');
        await loadUserData();
    } catch (e) { showToast('Silme hatası: ' + e.message, 'error'); }
};

let expenseChart = null, monthlyChart = null, accountChart = null,
    usdChart = null, eurChart = null, gramChart = null, ceyrekChart = null;

function updateCharts() {
    if (typeof Chart === 'undefined') return;

    const expenseCanvas = document.getElementById('expenseChart');
    const monthlyCanvas = document.getElementById('monthlyChart');
    const accountCanvas = document.getElementById('accountChart');
    const usdCanvas = document.getElementById('usdChart');
    const eurCanvas = document.getElementById('eurChart');
    const gramCanvas = document.getElementById('gramChart');
    const ceyrekCanvas = document.getElementById('ceyrekChart');
    if (!expenseCanvas || !monthlyCanvas || !accountCanvas || !usdCanvas || !eurCanvas || !gramCanvas || !ceyrekCanvas) return;

    const hidden = isHidden;

    // Kategori bazlı harcama
    const expenses = transactions.filter(t => t.type === 'expense');
    const categoryTotals = {};
    expenses.forEach(e => { categoryTotals[e.category] = (categoryTotals[e.category] || 0) + (Number(e.amount) || 0); });
    if (hidden) {
        if (expenseChart) { expenseChart.data.labels = []; expenseChart.data.datasets[0].data = []; expenseChart.update(); }
    } else if (!expenseChart) {
        expenseChart = new Chart(expenseCanvas, {
            type: 'doughnut',
            data: { labels: Object.keys(categoryTotals), datasets: [{ data: Object.values(categoryTotals), backgroundColor: ['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });
    } else {
        expenseChart.data.labels = Object.keys(categoryTotals);
        expenseChart.data.datasets[0].data = Object.values(categoryTotals);
        expenseChart.update();
    }

    // Aylık gelir/masraf
    const monthlyData = {};
    transactions.forEach(t => {
        const month = t.date.substring(0, 7);
        if (!monthlyData[month]) monthlyData[month] = { income: 0, expense: 0 };
        if (t.type === 'income') monthlyData[month].income += Number(t.amount) || 0;
        else monthlyData[month].expense += Number(t.amount) || 0;
    });
    transfers.forEach(t => {
        const month = t.date.substring(0, 7);
        const toAccount = accounts.find(a => a.id === t.toAccountId);
        const toAccountType = t.toAccountType || (toAccount ? toAccount.type : null);
        if (toAccountType === 'credit') {
            if (!monthlyData[month]) monthlyData[month] = { income: 0, expense: 0 };
            monthlyData[month].expense += t.amount;
        }
    });
    const sortedMonths = Object.keys(monthlyData).sort();
    if (hidden) {
        if (monthlyChart) { monthlyChart.data.labels = []; monthlyChart.data.datasets[0].data = []; monthlyChart.data.datasets[1].data = []; monthlyChart.update(); }
    } else if (!monthlyChart) {
        monthlyChart = new Chart(monthlyCanvas, {
            type: 'bar',
            data: { labels: sortedMonths.map(m => formatMonth(m)), datasets: [
                { label: 'Gelir', data: sortedMonths.map(m => monthlyData[m].income), backgroundColor: '#4CAF50' },
                { label: 'Masraf', data: sortedMonths.map(m => monthlyData[m].expense), backgroundColor: '#f44336' }
            ]},
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
    } else {
        monthlyChart.data.labels = sortedMonths.map(m => formatMonth(m));
        monthlyChart.data.datasets[0].data = sortedMonths.map(m => monthlyData[m].income);
        monthlyChart.data.datasets[1].data = sortedMonths.map(m => monthlyData[m].expense);
        monthlyChart.update();
    }

    // Hesap Bazlı Dağılım -> YATAY BAR
    if (hidden) {
        if (accountChart) { accountChart.data.labels = []; accountChart.data.datasets[0].data = []; accountChart.update(); }
    } else if (!accountChart) {
        accountChart = new Chart(accountCanvas, {
            type: 'bar',
            data: {
                labels: accounts.map(a => a.name),
                datasets: [{
                    data: accounts.map(getAccountValueTL),
                    backgroundColor: ['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40']
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true } }
            }
        });
    } else {
        accountChart.data.labels = accounts.map(a => a.name);
        accountChart.data.datasets[0].data = accounts.map(getAccountValueTL);
        accountChart.update();
    }

    // Döviz ve Altın Ayrı Grafikler
    const createInvestmentChart = (currency, canvas, chartVar, label) => {
        const investmentAccounts = accounts.filter(a => a.currency === currency);
        const totalQuantity = investmentAccounts.reduce((sum, a) => sum + getInvestmentMetrics(a).quantity, 0);
        const totalBuyCost = investmentAccounts.reduce((sum, a) => sum + getInvestmentMetrics(a).cost, 0);
        const totalCurrentValue = investmentAccounts.reduce((sum, a) => sum + getInvestmentMetrics(a).currentValue, 0);
        const profitLoss = totalCurrentValue - totalBuyCost;
        const profitPercentage = totalBuyCost > 0 ? (profitLoss / totalBuyCost) * 100 : 0;

        const data = [totalCurrentValue, totalBuyCost, profitLoss];
        const labels = ['Güncel Değer', 'Alış Maliyeti', 'Kâr / Zarar'];
        const backgroundColor = ['#4CAF50', '#f44336', profitLoss >= 0 ? '#2196F3' : '#ff5722'];

        if (hidden) {
            if (chartVar) { chartVar.data.labels = []; chartVar.data.datasets[0].data = []; chartVar.update(); }
            return chartVar;
        } else if (!chartVar) {
            return new Chart(canvas, {
                type: 'bar',
                data: { labels, datasets: [{ label: label, data, backgroundColor }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                afterLabel: function(context) {
                                    if (context.dataIndex === 2) return `Getiri Oranı: %${profitPercentage.toFixed(1)}`;
                                    return '';
                                }
                            }
                        }
                    }
                }
            });
        } else {
            chartVar.data.labels = labels;
            chartVar.data.datasets[0].data = data;
            chartVar.data.datasets[0].backgroundColor = backgroundColor;
            chartVar.options.plugins.tooltip.callbacks.afterLabel = function(context) {
                return context.dataIndex === 2 ? `Getiri Oranı: %${profitPercentage.toFixed(1)}` : '';
            };
            chartVar.update();
            return chartVar;
        }
    };

    usdChart = createInvestmentChart('USD', usdCanvas, usdChart, '💵 Dolar');
    eurChart = createInvestmentChart('EUR', eurCanvas, eurChart, '💶 Euro');
    gramChart = createInvestmentChart('GRAM_ALTIN', gramCanvas, gramChart, '🪙 Gram Altın');
    ceyrekChart = createInvestmentChart('CEYREK_ALTIN', ceyrekCanvas, ceyrekChart, '🪙 Çeyrek Altın');
}

async function saveSettings() {
    if (!currentUser) return;
    try {
        await db.collection('users').doc(currentUser.uid).set({
            currency: 'TRY',
            currentMonth: currentMonth,
            selectedAccounts: Array.from(selectedAccounts),
            themeColor: '#9C27B0'
        }, { merge: true });
    } catch (e) { console.error(e); }
}

async function clearAllData() {
    if (!confirm('Tüm veriler silinecek. Emin misiniz?')) return;
    if (!currentUser) return;
    try {
        for (const collection of ['accounts', 'transactions', 'transfers', 'recurringTransactions', 'goals']) {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection(collection).get();
            for (const doc of snapshot.docs) await doc.ref.delete();
        }
        accounts = []; transactions = []; transfers = []; recurringTransactions = []; goals = [];
        updateAllUI();
        showToast('Tüm veriler silindi!', 'success');
    } catch (e) { showToast('Silme hatası: ' + e.message, 'error'); }
}


// GİZLİLİK MODU: Kullanıcı belgesinde saklanır ve tüm açık tarayıcılara eşitlenir.
async function togglePrivacyMode() {
    if (!isHidden) {
        if (!currentUser) { showToast('Kullanıcı bulunamadı.', 'error'); return; }
        try {
            await db.collection('users').doc(currentUser.uid).set({ privacyModeEnabled: true }, { merge: true });
            showToast('Gizlilik modu açıldı', 'success');
        } catch (error) {
            console.error('Gizlilik modu güncelleme hatası:', error);
            showToast('Gizlilik modu güncellenemedi: ' + error.message, 'error');
        }
    } else {
        if (!currentUser) return;
        const hasPasswordProvider = currentUser.providerData.some(provider => provider.providerId === 'password');
        if (!hasPasswordProvider) {
            showToast('Gizlilik modunu kapatmak için e-posta/şifre ile giriş yapmalısınız.', 'error');
            return;
        }
        const password = await requestModernInput({
            title: 'Gizlilik modunu kapat',
            description: 'Devam etmek için hesabınızın şifresini girin.',
            label: 'Şifre',
            icon: 'fa-shield-halved',
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Şifrenizi yazın'
        });
        if (!password) return;
        try {
            const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, password);
            await currentUser.reauthenticateWithCredential(credential);
            await db.collection('users').doc(currentUser.uid).set({ privacyModeEnabled: false }, { merge: true });
            showToast('Gizlilik modu kapatıldı', 'success');
        } catch (error) {
            console.error('Şifre doğrulama hatası:', error);
            showToast('Şifre hatalı veya doğrulama başarısız: ' + error.message, 'error');
        }
    }
}

function toggleBalanceVisibility() {
    totalBalanceVisible = !totalBalanceVisible;
    updateDashboard();
}

