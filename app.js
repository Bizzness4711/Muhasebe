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
let currentThemeColor = 'green';
let exchangeRates = { TRY: 1, USD: 0, EUR: 0, GRAM_ALTIN: 0, CEYREK_ALTIN: 0 };
let recognition = null;
let receiptBase64 = null;
let isHidden = false;
let totalBalanceVisible = false;
let privacyModeUnsubscribe = null;
let notifications = [];
let securityTimeoutId = null;
let securityLocked = false;
let securityActivityBound = false;
let rateRefreshIntervalId = null;
let editingTransactionId = null;
let recurringProcessingPromise = null;

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
    const icon = document.createElement('i');
    icon.className = `fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`;
    const text = document.createElement('span');
    text.textContent = String(message);
    toast.append(icon, text);
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// Firestore'dan gelen kullanıcı metinlerini HTML içine yazmadan önce güvenli hale getir.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function notificationStorageKey() {
    return currentUser ? `notifications-${currentUser.uid}` : 'notifications';
}

function loadNotifications() {
    try {
        notifications = JSON.parse(localStorage.getItem(notificationStorageKey()) || '[]');
        if (!Array.isArray(notifications)) notifications = [];
    } catch (error) {
        console.warn('Bildirimler okunamadı.', error);
        notifications = [];
    }
}

function saveNotifications() {
    localStorage.setItem(notificationStorageKey(), JSON.stringify(notifications.slice(0, 40)));
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

function addNotification(id, message, icon = 'fa-bell') {
    if (notifications.some(item => item.id === id)) return;
    notifications.unshift({ id, message, icon, read: false, createdAt: new Date().toISOString() });
    saveNotifications();
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Finora', { body: message });
}

function updateNotificationsUI() {
    const list = document.getElementById('notificationList');
    const count = document.getElementById('notificationCount');
    if (!list || !count) return;
    const unread = notifications.filter(item => !item.read);
    count.textContent = unread.length > 99 ? '99+' : String(unread.length);
    count.hidden = unread.length === 0;
    list.innerHTML = notifications.length
        ? notifications.slice(0, 12).map(item => `<div class="notification-item"><i class="fas ${escapeHtml(item.icon)}"></i><span>${escapeHtml(item.message)}</span></div>`).join('')
        : '<div class="notification-empty">Yeni bildiriminiz yok.</div>';
}

const rateAlertCurrencies = ['USD', 'EUR', 'GRAM_ALTIN', 'CEYREK_ALTIN'];
const rateAlertLabels = { USD: 'Dolar', EUR: 'Euro', GRAM_ALTIN: 'Gram altın', CEYREK_ALTIN: 'Çeyrek altın' };

function rateAlertStorageKey() {
    return currentUser ? `rate-alerts-${currentUser.uid}` : null;
}

function defaultRateAlertSettings() {
    return { frequencyHours: 6, limits: {}, states: {}, lastCurrentNotification: {} };
}

function loadRateAlertSettings() {
    const key = rateAlertStorageKey();
    if (!key) return defaultRateAlertSettings();
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        const settings = { ...defaultRateAlertSettings(), ...parsed };
        settings.limits = settings.limits && typeof settings.limits === 'object' ? settings.limits : {};
        settings.states = settings.states && typeof settings.states === 'object' ? settings.states : {};
        settings.lastCurrentNotification = settings.lastCurrentNotification && typeof settings.lastCurrentNotification === 'object' ? settings.lastCurrentNotification : {};
        return settings;
    } catch (error) {
        console.warn('Kur bildirim ayarları okunamadı.', error);
        return defaultRateAlertSettings();
    }
}

function saveRateAlertSettings(settings) {
    const key = rateAlertStorageKey();
    if (key) localStorage.setItem(key, JSON.stringify(settings));
}

function updateRateAlertInputs() {
    const settings = loadRateAlertSettings();
    rateAlertCurrencies.forEach(currency => {
        const limits = settings.limits[currency] || {};
        const lower = document.getElementById(`alertLower${currency}`);
        const upper = document.getElementById(`alertUpper${currency}`);
        if (lower) lower.value = limits.lower ?? '';
        if (upper) upper.value = limits.upper ?? '';
    });
    const frequency = document.getElementById('rateAlertFrequency');
    if (frequency) frequency.value = String(settings.frequencyHours || 6);
}

function checkRateAlerts() {
    if (!currentUser) return;
    const settings = loadRateAlertSettings();
    const now = Date.now();
    rateAlertCurrencies.forEach(currency => {
        const rate = Number(exchangeRates[currency]);
        if (!(rate > 0)) return;
        const limits = settings.limits[currency] || {};
        const lower = Number(limits.lower);
        const upper = Number(limits.upper);
        const hasLower = Number.isFinite(lower) && lower > 0;
        const hasUpper = Number.isFinite(upper) && upper > 0;
        let state = 'normal';
        if (hasLower && rate < lower) state = 'below';
        else if (hasUpper && rate > upper) state = 'above';

        if (state !== 'normal' && settings.states[currency] !== state) {
            const direction = state === 'below' ? 'alt limitin altında' : 'üst limitin üstünde';
            addNotification(`rate-limit-${currency}-${state}-${now}`, `${rateAlertLabels[currency]} kuru ₺${rate.toFixed(2)} ile ${direction}.`, state === 'below' ? 'fa-arrow-trend-down' : 'fa-arrow-trend-up');
        }
        settings.states[currency] = state;

        if (!hasLower && !hasUpper) {
            const frequencyMs = Math.max(1, Number(settings.frequencyHours) || 6) * 60 * 60 * 1000;
            const lastNotification = Number(settings.lastCurrentNotification[currency]) || 0;
            if (now - lastNotification >= frequencyMs) {
                addNotification(`rate-current-${currency}-${Math.floor(now / frequencyMs)}`, `${rateAlertLabels[currency]} güncel kuru: ₺${rate.toFixed(2)}.`, 'fa-chart-line');
                settings.lastCurrentNotification[currency] = now;
            }
        }
    });
    saveRateAlertSettings(settings);
}

function scheduleRateRefresh() {
    if (rateRefreshIntervalId) clearInterval(rateRefreshIntervalId);
    if (!currentUser) return;
    rateRefreshIntervalId = setInterval(() => {
        fetchExchangeRates();
    }, 60 * 60 * 1000);
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showToast('Bu tarayıcı masaüstü bildirimlerini desteklemiyor.', 'error');
        return;
    }
    const permission = await Notification.requestPermission();
    showToast(permission === 'granted' ? 'Masaüstü bildirimleri açıldı.' : 'Bildirim izni verilmedi.', permission === 'granted' ? 'success' : 'error');
}

function checkNotifications() {
    const today = new Date().toISOString().split('T')[0];
    transactions.filter(item => item.recurringId && item.date === today).forEach(item => {
        addNotification(`recurring-${item.id}`, `Tekrarlayan işlem oluşturuldu: ${item.description}.`, 'fa-rotate');
    });

    goals.forEach(goal => {
        const progress = goal.amount > 0 ? (goal.current / goal.amount) * 100 : 0;
        const milestone = progress >= 100 ? 100 : progress >= 75 ? 75 : progress >= 50 ? 50 : progress >= 25 ? 25 : 0;
        if (milestone > 0) addNotification(`goal-${goal.id}-${milestone}`, `${goal.name} hedefiniz %${milestone} seviyesine ulaştı${milestone === 100 ? '!' : '.'}`, 'fa-bullseye');
    });

    investmentCurrencies.forEach(currency => {
        const accountsForCurrency = accounts.filter(account => account.currency === currency);
        const total = accountsForCurrency.reduce((sum, account) => sum + getInvestmentMetrics(account).profitLoss, 0);
        const direction = total >= 0 ? 'kâr' : 'zarar';
        const rounded = Math.round(Math.abs(total));
        if (rounded > 0) addNotification(`market-${currency}-${direction}-${rounded}`, `${currency} varlığınızda yaklaşık ₺${rounded} ${direction} oluştu.`, total >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down');
    });
}

function applyThemeColor(color) {
    const colors = {
        green: { primary: '#4CAF50', dark: '#45a049' },
        blue: { primary: '#2196F3', dark: '#1976D2' },
        purple: { primary: '#9C27B0', dark: '#7B1FA2' },
        orange: { primary: '#FF9800', dark: '#F57C00' }
    };
    const hexColor = colors[color]?.primary || (/^#[0-9a-f]{6}$/i.test(color) ? color : colors.green.primary);
    const rgb = hexToRgb(hexColor);
    currentThemeColor = hexColor;

    document.documentElement.style.setProperty('--primary-color', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
    document.documentElement.style.setProperty('--primary-dark', `rgb(${Math.round(rgb.r * 0.8)}, ${Math.round(rgb.g * 0.8)}, ${Math.round(rgb.b * 0.8)})`);
    document.documentElement.style.setProperty('--primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);

    const picker = document.getElementById('themeColorPicker');
    const colorValue = document.getElementById('themeColorValue');
    if (colorValue) colorValue.textContent = `RGB(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    ['themeRed', 'themeGreen', 'themeBlue'].forEach((id, index) => {
        const input = document.getElementById(id);
        if (input) input.value = [rgb.r, rgb.g, rgb.b][index];
    });
    if (picker) picker.querySelectorAll('.theme-swatch').forEach(swatch => {
        swatch.classList.toggle('active', swatch.dataset.colorValue.toLowerCase() === hexColor.toLowerCase());
    });

    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === color);
    });
}

function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

async function fetchExchangeRates() {
    try {
    const [currencyResult, goldResult] = await Promise.allSettled([
        fetch('https://api.exchangerate-api.com/v4/latest/USD').then(response => {
            if (!response.ok) throw new Error('Döviz kuru alınamadı');
            return response.json();
        }),
        fetch('https://xaus.com/api/v1/spot?currency=TRY&unit=gram').then(response => {
            if (!response.ok) throw new Error('Altın kuru alınamadı');
            return response.json();
        })
    ]);

    if (currencyResult.status === 'fulfilled') {
        const data = currencyResult.value;
        exchangeRates.USD = Number(data.rates?.TRY) || exchangeRates.USD;
        exchangeRates.EUR = exchangeRates.USD && data.rates?.EUR ? exchangeRates.USD / Number(data.rates.EUR) : exchangeRates.EUR;
    } else {
        console.warn('Döviz kurları güncellenemedi.', currencyResult.reason);
    }

    if (goldResult.status === 'fulfilled') {
        const gramPrice = Number(goldResult.value.xau?.price);
        if (gramPrice > 0) {
            exchangeRates.GRAM_ALTIN = gramPrice;
            // Standart çeyrek altın: 1,75 gr ve 22 ayar (22/24 saf altın oranı).
            exchangeRates.CEYREK_ALTIN = gramPrice * 1.75 * (22 / 24);
        }
    } else {
        console.warn('Altın kurları güncellenemedi.', goldResult.reason);
    }
    } finally {
        updateExchangeRatesDisplay();
        if (currentUser) {
            updateAllUI();
            checkNotifications();
            checkRateAlerts();
            updateNotificationsUI();
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
        loadNotifications();
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        const userName = user.displayName || user.email.split('@')[0];
        document.getElementById('userName').textContent = userName;
        document.getElementById('userAvatar').innerHTML = userName.charAt(0).toUpperCase();

        isHidden = true;
        totalBalanceVisible = false;
        updateAllUI();
        checkNotifications();
        updateNotificationsUI();

        subscribeToPrivacyMode(user.uid);
        await fetchExchangeRates();
        await loadUserData();
        await configureSecurityUI();
        updateRateAlertInputs();
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
                themeColor: 'green',
                privacyModeEnabled: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            const settings = userDoc.data();
            currentCurrency = settings.currency || 'TRY';
            if (settings.currentMonth) currentMonth = settings.currentMonth;
            if (settings.themeColor) { currentThemeColor = settings.themeColor; applyThemeColor(currentThemeColor); }
            isHidden = Boolean(settings.privacyModeEnabled);
            const currencySetting = document.getElementById('currencySetting');
            if (currencySetting) currencySetting.value = currentCurrency;
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

        updateAllUI();
        checkNotifications();
        updateNotificationsUI();
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
    updateAccountsUI();
    updateDashboard();
    updateTransactionsUI();
    updateRecurringTransactionsUI();
    updateGoalsUI();
    updateCharts();
    updateProfitLossReport();
    updateAdvancedReports();
    updateBalanceForecast();
    updateGoalAccountSelect();
    const monthDisplay = document.getElementById('currentMonthDisplay');
    if (monthDisplay) monthDisplay.textContent = formatMonth(currentMonth);
}

function getTransactionValueTL(transaction) {
    const account = accounts.find(item => item.id === transaction.accountId);
    if (!isInvestmentAccount(account)) return Number(transaction.amount || 0);
    const rate = Number(transaction.transactionRate || exchangeRates[transaction.accountCurrency] || getAccountOpeningRate(account) || 0);
    return Number(transaction.amount || 0) * rate;
}

function getAssistantAnswer(question) {
    const normalized = question.toLocaleLowerCase('tr-TR');
    const currentExpenses = transactions.filter(item => item.type === 'expense' && item.date?.startsWith(currentMonth));
    const currentIncome = transactions.filter(item => item.type === 'income' && item.date?.startsWith(currentMonth));
    const incomeTotal = currentIncome.reduce((sum, item) => sum + getTransactionValueTL(item), 0);
    const expenseTotal = currentExpenses.reduce((sum, item) => sum + getTransactionValueTL(item), 0);
    const previousMonthDate = new Date(`${currentMonth}-01T12:00:00`);
    previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
    const previousMonth = previousMonthDate.toISOString().substring(0, 7);
    const previousExpenses = transactions.filter(item => item.type === 'expense' && item.date?.startsWith(previousMonth));
    const previousExpenseTotal = previousExpenses.reduce((sum, item) => sum + getTransactionValueTL(item), 0);
    const expenseChange = previousExpenseTotal > 0 ? ((expenseTotal - previousExpenseTotal) / previousExpenseTotal) * 100 : 0;
    const categoryTotals = currentExpenses.reduce((result, item) => {
        const category = (item.category || 'Diğer').replace(/^[^A-Za-zÇĞİÖŞÜçğıöşü0-9]+/u, '').trim() || 'Diğer';
        result[category] = (result[category] || 0) + getTransactionValueTL(item);
        return result;
    }, {});
    const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
    const savings = incomeTotal - expenseTotal;

    if (normalized.includes('neden') || normalized.includes('azaldı') || normalized.includes('azaldi')) {
        if (!currentExpenses.length) return 'Bu ay henüz gider kaydı görünmüyor. Yeni işlemler eklendikçe harcama nedenlerini analiz edebilirim.';
        const changeText = previousExpenseTotal > 0
            ? `Geçen aya göre harcamaların %${Math.abs(expenseChange).toFixed(0)} ${expenseChange >= 0 ? 'arttı' : 'azaldı'}.`
            : 'Geçen ay karşılaştırılabilir bir gider verisi yok.';
        const categoryText = topCategory ? `En yüksek harcama ${topCategory[0]} kategorisinde: ₺${topCategory[1].toFixed(2)}.` : '';
        return `${changeText} ${categoryText} Bu ay toplam ₺${expenseTotal.toFixed(2)} harcama yaptın.`;
    }

    if (normalized.includes('birikt') || normalized.includes('tasarruf') || normalized.includes('5000') || normalized.includes('5.000')) {
        const requested = Number((question.match(/[\d.]+/) || ['5000'])[0].replace(/\./g, '')) || 5000;
        return savings >= requested
            ? `Evet. Mevcut verilere göre bu ay yaklaşık ₺${savings.toFixed(2)} ayırabilirsin; ₺${requested.toFixed(2)} hedefin ulaşılabilir görünüyor.`
            : `Şu anki gelir-gider verilerine göre yaklaşık ₺${Math.max(0, savings).toFixed(2)} tasarruf alanı var. ₺${requested.toFixed(2)} hedefi için ₺${Math.max(0, requested - savings).toFixed(2)} daha alan açman gerekir.`;
    }

    return `Bu ay ₺${incomeTotal.toFixed(2)} gelir ve ₺${expenseTotal.toFixed(2)} gider kaydı var. Gelir-gider farkın ₺${savings.toFixed(2)}. “Bu ay param neden azaldı?” veya “₺5.000 biriktirebilir miyim?” diye sorabilirsin.`;
}

function askFinanceAssistant(question) {
    const response = document.getElementById('assistantResponse');
    if (!response) return;
    const trimmedQuestion = String(question || '').trim();
    if (!trimmedQuestion) return;
    if (isHidden) {
        response.innerHTML = '<i class="fas fa-lock"></i><span>Gizlilik modu açıkken finansal analiz gösterilemiyor.</span>';
        return;
    }
    response.innerHTML = `<i class="fas fa-sparkles"></i><span>${escapeHtml(getAssistantAnswer(trimmedQuestion))}</span>`;
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
    const monthDisplay = document.getElementById('currentMonthDisplay');

    if (isHidden) {
        if (totalBalanceEl) totalBalanceEl.textContent = totalBalanceVisible ? `₺${totalBalance.toFixed(2)}` : '₺••••••';
        if (totalIncomeEl) totalIncomeEl.textContent = '₺••••••';
        if (totalExpenseEl) totalExpenseEl.textContent = '₺••••••';
        if (savingsRateEl) savingsRateEl.textContent = '%••••';
        if (investmentSummaryEl) investmentSummaryEl.textContent = '₺••••••';
        if (investmentProfitLossEl) investmentProfitLossEl.textContent = 'Kâr/Zarar: ₺••••••';
        if (upcomingInstallmentsEl) upcomingInstallmentsEl.textContent = '₺••••••';
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
            receiptBase64: t.receiptBase64 || null,
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
        
        let receiptIcon = '';
        if (item.receiptBase64) receiptIcon = `<button class="receipt-link" onclick="showReceipt('${item.receiptBase64}')" title="Fişi Gör"><i class="fas fa-receipt"></i></button>`;
        
        return `<div class="transaction-card-modern">
            <div class="transaction-icon-modern ${amountClass}"><i class="fas ${icon}"></i></div>
            <div class="transaction-info-modern">
                <div class="transaction-title-modern">${escapeHtml(item.category)}</div>
                <div class="transaction-subtitle-modern">${escapeHtml(item.description)} • ${escapeHtml(item.date)}${purchaseRateDisplay}${transactionRateDisplay}${profitLossDisplay}${installmentDisplay}</div>
            </div>
            ${receiptIcon}
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

function showReceipt(base64Data) {
    const win = window.open();
    if (!win) {
        showToast('Fişi görüntülemek için açılır pencerelere izin verin.', 'error');
        return;
    }
    win.document.write(`<img src="${base64Data}" style="max-width:100%;">`);
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
            currency: currentCurrency,
            currentMonth: currentMonth,
            selectedAccounts: Array.from(selectedAccounts),
            themeColor: currentThemeColor
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

function exportData() {
    const data = { settings: { currency: currentCurrency, currentMonth: currentMonth, selectedAccounts: Array.from(selectedAccounts), themeColor: currentThemeColor }, accounts, transactions, transfers, recurringTransactions, goals };
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    link.setAttribute('download', `finance-data-${new Date().toISOString().split('T')[0]}.json`);
    link.click();
    showToast('Veriler dışa aktarıldı!', 'success');
}

async function importData(file) {
    if (!file || !currentUser) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.settings) {
                if (data.settings.currency) { currentCurrency = data.settings.currency; const el = document.getElementById('currencySetting'); if (el) el.value = currentCurrency; }
                if (data.settings.currentMonth) currentMonth = data.settings.currentMonth;
                if (data.settings.selectedAccounts) selectedAccounts = new Set(data.settings.selectedAccounts);
                if (data.settings.themeColor) { currentThemeColor = data.settings.themeColor; applyThemeColor(currentThemeColor); }
                await db.collection('users').doc(currentUser.uid).set({ currency: currentCurrency, currentMonth: currentMonth, selectedAccounts: Array.from(selectedAccounts), themeColor: currentThemeColor }, { merge: true });
            }
            // Dışa aktarılan ID'leri koru; aksi halde transaction.accountId ve
            // recurringId referansları yeni hesaplara bağlanamıyordu.
            const importCollection = async (name, items) => {
                if (!Array.isArray(items)) return;
                for (const item of items) {
                    const { id, ...rest } = item || {};
                    const ref = id && typeof id === 'string' ? db.collection('users').doc(currentUser.uid).collection(name).doc(id) : db.collection('users').doc(currentUser.uid).collection(name).doc();
                    await ref.set(rest);
                }
            };
            await importCollection('accounts', data.accounts);
            await importCollection('transactions', data.transactions);
            await importCollection('transfers', data.transfers);
            await importCollection('recurringTransactions', data.recurringTransactions);
            await importCollection('goals', data.goals);
            await loadUserData();
            showToast('Veriler başarıyla içe aktarıldı!', 'success');
        } catch (error) { showToast('Dosya okunamadı: ' + error.message, 'error'); }
    };
    reader.readAsText(file);
}

// SESLİ KOMUT
function startVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        showToast('Tarayıcınız sesli komut desteklemiyor.', 'error');
        return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    document.getElementById('voiceResult').innerHTML = '<p>Dinleniyor... 🎤</p>';
    recognition.start();
    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        document.getElementById('voiceResult').innerHTML = `<p><strong>Algılanan:</strong> "${escapeHtml(transcript)}"</p>`;
        processVoiceCommand(transcript);
    };
    recognition.onerror = function(event) {
        document.getElementById('voiceResult').innerHTML = '';
        showToast('Ses algılama hatası: ' + event.error, 'error');
    };
    recognition.onend = function() {
        document.getElementById('voiceResult').innerHTML += '<p>Dinleme bitti.</p>';
    };
}

function processVoiceCommand(text) {
    const lower = text.toLowerCase();
    let type = null;
    let amount = null;
    let accountName = null;
    let category = null;

    const amountMatch = lower.match(/(\d+([.,]\d+)?)\s*(tl|lira|₺|dolar|euro|eur|usd)/);
    if (amountMatch) amount = parseFloat(amountMatch[1].replace(',', '.'));

    if (lower.includes('gelir') || lower.includes('maaş') || lower.includes('para geldi') || lower.includes('kazand')) type = 'income';
    else if (lower.includes('masraf') || lower.includes('harca') || lower.includes('öde') || lower.includes('aldım') || lower.includes('ald')) type = 'expense';
    else if (lower.includes('transfer') || lower.includes('gönder') || lower.includes('havale')) type = 'transfer';

    for (const acc of accounts) {
        if (lower.includes(acc.name.toLowerCase())) {
            accountName = acc.name;
            break;
        }
    }

    if (lower.includes('market')) category = '🛒 Market';
    else if (lower.includes('yemek') || lower.includes('restoran')) category = '🍔 Yemek';
    else if (lower.includes('ulaşım') || lower.includes('taksi') || lower.includes('otobüs')) category = '🚗 Ulaşım';
    else if (lower.includes('fatura')) category = '💡 Faturalar';
    else if (lower.includes('kira')) category = '🏠 Kira';
    else if (lower.includes('eğlence')) category = '🎮 Eğlence';
    else if (lower.includes('sağlık')) category = '💊 Sağlık';
    else if (lower.includes('eğitim')) category = '📚 Eğitim';
    else if (lower.includes('giyim')) category = '👕 Giyim';
    else if (lower.includes('teknoloji') || lower.includes('telefon')) category = '📱 Teknoloji';
    else category = '📋 Diğer';

    if (type === 'transfer') {
        showToast('Transfer işlemi için lütfen formu kullanın.', 'warning');
        return;
    }

    if (!type || !amount || !accountName) {
        showToast('Komut tam anlaşılamadı. Lütfen tekrar deneyin.', 'error');
        return;
    }

    selectedType = type;
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
    document.getElementById('accountSelect').value = accounts.find(a => a.name === accountName)?.id || '';
    document.getElementById('amount').value = amount;
    document.getElementById('category').value = category;
    document.getElementById('description').value = 'Sesli komut ile eklendi';
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    showToast('Form dolduruldu, lütfen kaydet butonuna basın.', 'success');
}

// FİŞ YÜKLEME (Base64)
async function handleReceiptUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const preview = document.getElementById('receiptPreview');
    preview.innerHTML = '<p>Fiş okunuyor... ⏳</p>';
    
    const reader = new FileReader();
    reader.onload = (e) => {
        receiptBase64 = e.target.result;
        preview.innerHTML += `<img src="${e.target.result}" style="max-width:100%; max-height:200px; border-radius:10px; margin-top:10px;">`;
    };
    reader.readAsDataURL(file);

    try {
        const result = await Tesseract.recognize(file, 'tur');
        const text = result.data.text;
        preview.innerHTML += `<p><strong>Okunan Metin:</strong></p><pre style="white-space:pre-wrap; font-size:12px;">${escapeHtml(text)}</pre>`;
        
        const amountMatch = text.match(/(\d+[.,]\d{2})\s*₺|₺\s*(\d+[.,]\d{2})|(\d+[.,]\d{2})\s*TL/);
        if (amountMatch) {
            let amountStr = amountMatch[1] || amountMatch[2] || amountMatch[3];
            amountStr = amountStr.replace(',', '.');
            const amount = parseFloat(amountStr);
            if (!isNaN(amount)) {
                document.getElementById('amount').value = amount.toFixed(2);
                preview.innerHTML += `<p><strong>Bulunan Tutar:</strong> ₺${amount.toFixed(2)}</p>`;
            }
        }
        const dateMatch = text.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
        if (dateMatch) {
            const dateStr = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
            document.getElementById('date').value = dateStr;
            preview.innerHTML += `<p><strong>Bulunan Tarih:</strong> ${dateStr}</p>`;
        }
        
        showToast('Fiş başarıyla okundu. Lütfen hesap seçip kaydedin.', 'success');
    } catch (error) {
        console.error(error);
        preview.innerHTML += '<p>OCR okuma başarısız. Lütfen tutarı elle girin.</p>';
        showToast('Fiş okunamadı.', 'error');
    }
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

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Uygulama başlatıldı');

    // Gizlilik butonu
    document.getElementById('privacyModeBtn').addEventListener('click', togglePrivacyMode);
    document.getElementById('assistantForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('assistantQuestion');
        askFinanceAssistant(input.value);
        input.value = '';
    });
    document.querySelectorAll('.assistant-suggestion').forEach(button => {
        button.addEventListener('click', () => {
            const question = button.dataset.question || '';
            document.getElementById('assistantQuestion').value = question;
            askFinanceAssistant(question);
        });
    });

    // Göz butonu
    document.getElementById('toggleBalanceBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        toggleBalanceVisibility();
    });

    // Bakiye kartı (özet modal)
    document.getElementById('balanceCard').addEventListener('click', showAccountSummary);
    document.getElementById('notificationBtn').addEventListener('click', (event) => {
        event.stopPropagation();
        const panel = document.getElementById('notificationPanel');
        panel.hidden = !panel.hidden;
        updateNotificationsUI();
    });
    document.getElementById('clearNotificationsBtn').addEventListener('click', () => {
        notifications = notifications.map(item => ({ ...item, read: true }));
        saveNotifications();
        updateNotificationsUI();
    });
    document.getElementById('enableNotificationsBtn').addEventListener('click', requestNotificationPermission);
    document.getElementById('enableNotificationsSettingBtn').addEventListener('click', requestNotificationPermission);
    document.addEventListener('click', (event) => {
        const wrapper = document.querySelector('.notification-wrap');
        if (wrapper && !wrapper.contains(event.target)) document.getElementById('notificationPanel').hidden = true;
    });
    document.getElementById('closeAccountSummary').addEventListener('click', () => {
        document.getElementById('accountSummaryModal').style.display = 'none';
    });
    document.getElementById('accountSummaryModal').addEventListener('click', (event) => {
        if (event.target.id === 'accountSummaryModal') event.currentTarget.style.display = 'none';
    });
    document.getElementById('upcomingInstallmentsCard').addEventListener('click', showInstallmentSummary);
    document.getElementById('upcomingInstallmentsCard').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            showInstallmentSummary();
        }
    });
    document.getElementById('closeInstallmentSummary').addEventListener('click', () => {
        document.getElementById('installmentSummaryModal').style.display = 'none';
    });
    document.getElementById('installmentSummaryModal').addEventListener('click', (event) => {
        if (event.target.id === 'installmentSummaryModal') event.currentTarget.style.display = 'none';
    });

    document.getElementById('isRecurring').addEventListener('change', (event) => {
        document.getElementById('recurringOptions').hidden = !event.target.checked;
    });

    // Hesap ekleme modalında para birimi değişince
    document.getElementById('accountCurrency').addEventListener('change', function() {
        const investmentDetails = document.getElementById('investmentDetails');
        const balanceGroup = document.getElementById('accountBalanceGroup');
        const quantityInput = document.getElementById('accountQuantity');
        const buyPriceInput = document.getElementById('accountBuyPrice');
        const isInvestment = investmentCurrencies.includes(this.value);
        if (isInvestment) {
            investmentDetails.style.display = 'block';
            balanceGroup.style.display = 'none';
            quantityInput.required = true;
            buyPriceInput.required = true;
            // Seçilen para birimi için güncel kuru birim alış fiyatı olarak doldur
            const rate = exchangeRates[this.value];
            if (rate && rate > 0) {
                buyPriceInput.value = rate.toFixed(2);
            }
        } else {
            investmentDetails.style.display = 'none';
            balanceGroup.style.display = 'block';
            quantityInput.required = false;
            buyPriceInput.required = false;
            buyPriceInput.value = '';
        }
    });

    // Hesap ekleme formu
    document.getElementById('accountForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        const currency = document.getElementById('accountCurrency').value;
        const isInvestment = investmentCurrencies.includes(currency);
        const quantity = parseFloat(document.getElementById('accountQuantity').value);
        const buyPrice = parseFloat(document.getElementById('accountBuyPrice').value);
        if (isInvestment && (!(quantity > 0) || !(buyPrice > 0))) {
            showToast('Yatırım hesabı için alınan miktar ve birim alış fiyatı girin.', 'error');
            return;
        }
        const accountData = {
            name: document.getElementById('accountName').value,
            label: document.getElementById('accountLabel').value.trim(),
            color: document.getElementById('accountColor').value,
            type: isInvestment ? 'investment' : document.getElementById('accountType').value,
            currency: currency,
            balance: isInvestment ? quantity : (parseFloat(document.getElementById('accountBalance').value) || 0),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (accountData.type === 'credit') {
            accountData.creditLimit = parseFloat(document.getElementById('accountCreditLimit').value) || 0;
            accountData.statementDay = parseInt(document.getElementById('accountStatementDay').value, 10) || null;
            accountData.dueDay = parseInt(document.getElementById('accountDueDay').value, 10) || null;
            accountData.minimumPaymentRate = parseFloat(document.getElementById('accountMinimumPaymentRate').value) || 20;
            accountData.balance = -(Math.abs(accountData.balance));
        }
        if (isInvestment) {
            accountData.quantity = quantity;
            accountData.buyPrice = buyPrice;
            accountData.openingRate = buyPrice;
            accountData.openingRateDate = new Date().toISOString();
        }
        try {
            await db.collection('users').doc(currentUser.uid).collection('accounts').add(accountData);
            document.getElementById('accountForm').reset();
            document.getElementById('accountCurrency').dispatchEvent(new Event('change'));
            document.getElementById('addAccountModal').style.display = 'none';
            showToast('Hesap eklendi!', 'success');
            await loadUserData();
        } catch (error) { showToast('Hesap eklenirken hata: ' + error.message, 'error'); }
    });

    // Sidebar navigasyonu
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            const pageEl = document.getElementById(page);
            if (pageEl) pageEl.classList.add('active');
            document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('show');
            if (link.dataset.assistantTarget === 'true') {
                setTimeout(() => {
                    const assistant = document.getElementById('finance-assistant');
                    assistant?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    document.getElementById('assistantQuestion')?.focus({ preventScroll: true });
                }, 80);
            }
            if (page === 'reports') setTimeout(updateCharts, 500);
        });
    });
    const reportPeriodSelect = document.getElementById('reportPeriod');
    if (reportPeriodSelect) {
        reportPeriodSelect.addEventListener('change', (event) => {
            reportPeriod = event.target.value;
            updateAdvancedReports();
        });
    }

    document.getElementById('newTransactionBtn').addEventListener('click', () => {
        editingTransactionId = null;
        document.getElementById('transactionForm').reset();
        document.getElementById('date').value = new Date().toISOString().split('T')[0];
        document.getElementById('recurringOptions').hidden = true;
        document.getElementById('installmentOptions').hidden = true;
        document.getElementById('creditInstallmentDetails').hidden = true;
        document.getElementById('transactionSubmitBtn').innerHTML = '<i class="fas fa-save"></i> Kaydet';
        selectedType = 'expense';
        document.querySelectorAll('.type-btn').forEach(button => button.classList.toggle('active', button.dataset.type === 'expense'));
        updateCategorySelect();
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.getElementById('add-transaction').classList.add('active');
        document.querySelectorAll('.sidebar-link').forEach(link => link.classList.remove('active'));
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('show');
    });

    // Menü butonu
    document.getElementById('menuBtn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebarOverlay').classList.toggle('show');
    });
    document.getElementById('sidebarOverlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('show');
    });

    // Tema
    document.getElementById('themeBtn').addEventListener('click', () => {
        const currentTheme = document.body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme-v2', newTheme);
        document.querySelector('#themeBtn i').className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    });

    // Kur güncelle
    document.getElementById('updateRatesBtn').addEventListener('click', async () => {
        await fetchExchangeRates();
        showToast('Kurlar güncellendi!', 'success');
    });

    // Ay navigasyonu
    document.getElementById('prevMonth').onclick = () => window.changeMonth(-1);
    document.getElementById('nextMonth').onclick = () => window.changeMonth(1);

    // Giriş
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await auth.signInWithEmailAndPassword(document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
            showToast('Giriş başarılı!', 'success');
        } catch (error) { showToast('Giriş hatası: ' + error.message, 'error'); }
    });

    // Kayıt
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const result = await auth.createUserWithEmailAndPassword(document.getElementById('registerEmail').value, document.getElementById('registerPassword').value);
            await result.user.updateProfile({ displayName: document.getElementById('registerName').value });
            showToast('Kayıt başarılı!', 'success');
        } catch (error) { showToast('Kayıt hatası: ' + error.message, 'error'); }
    });

    // Google girişi
    document.getElementById('googleLogin').addEventListener('click', async () => {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
            showToast('Google ile giriş başarılı!', 'success');
        } catch (error) { showToast('Google giriş hatası: ' + error.message, 'error'); }
    });

    // Çıkış
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await auth.signOut();
        showToast('Çıkış yapıldı!', 'success');
    });

    // Auth tab
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById('loginForm').style.display = tabName === 'login' ? 'block' : 'none';
            document.getElementById('registerForm').style.display = tabName === 'register' ? 'block' : 'none';
            document.getElementById('authPanelKicker').textContent = tabName === 'login' ? 'HOŞ GELDİNİZ' : 'İLK ADIMI ATIN';
            document.getElementById('authPanelTitle').textContent = tabName === 'login' ? 'Tekrar hoş geldin' : 'Hesabını oluştur';
            document.getElementById('authPanelSubtitle').textContent = tabName === 'login' ? 'Hesabınıza giriş yaparak devam edin.' : 'Bütçenizi düzenlemeye hemen başlayın.';
        });
    });

    // Şifre göster/gizle
    document.querySelectorAll('.auth-password-toggle').forEach(button => button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.target);
        const icon = button.querySelector('i');
        input.type = input.type === 'password' ? 'text' : 'password';
        icon.className = input.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
        button.setAttribute('aria-label', input.type === 'password' ? 'Şifreyi göster' : 'Şifreyi gizle');
    }));

    // Hesap ekleme modalı açma/kapama
    document.getElementById('addAccountBtn').addEventListener('click', () => { document.getElementById('addAccountModal').style.display = 'flex'; });
    document.getElementById('cancelAccount').addEventListener('click', () => { document.getElementById('addAccountModal').style.display = 'none'; });

    // Hesap düzenleme modalı
    document.getElementById('cancelEditAccount').addEventListener('click', () => { document.getElementById('editAccountModal').style.display = 'none'; });
    document.getElementById('editAccountCurrency').addEventListener('change', function() {
        updateEditAccountFields();
        // Seçilen para birimi için güncel kuru birim alış fiyatı olarak doldur
        const isInvestment = investmentCurrencies.includes(this.value);
        const buyPriceInput = document.getElementById('editAccountBuyPrice');
        if (isInvestment) {
            const rate = exchangeRates[this.value];
            if (rate && rate > 0) {
                buyPriceInput.value = rate.toFixed(2);
            }
        } else {
            buyPriceInput.value = '';
        }
    });
    document.getElementById('editAccountForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;

        const id = document.getElementById('editAccountId').value;
        const account = accounts.find(item => item.id === id);
        const currency = document.getElementById('editAccountCurrency').value;
        const isInvestment = investmentCurrencies.includes(currency);
        const quantity = parseFloat(document.getElementById('editAccountQuantity').value);
        const buyPrice = parseFloat(document.getElementById('editAccountBuyPrice').value);
        if (isInvestment && (!(quantity > 0) || !(buyPrice > 0))) {
            showToast('Yatırım hesabı için alınan miktar ve birim alış fiyatı girin.', 'error');
            return;
        }

        const updates = {
            name: document.getElementById('editAccountName').value.trim(),
            label: document.getElementById('editAccountLabel').value.trim(),
            color: document.getElementById('editAccountColor').value,
            currency,
            type: isInvestment ? 'investment' : document.getElementById('editAccountType').value,
            balance: isInvestment ? quantity : (parseFloat(document.getElementById('editAccountBalance').value) || 0)
        };
        if (updates.type === 'credit') {
            updates.creditLimit = parseFloat(document.getElementById('editAccountCreditLimit').value) || 0;
            updates.statementDay = parseInt(document.getElementById('editAccountStatementDay').value, 10) || null;
            updates.dueDay = parseInt(document.getElementById('editAccountDueDay').value, 10) || null;
            updates.minimumPaymentRate = parseFloat(document.getElementById('editAccountMinimumPaymentRate').value) || 20;
            updates.balance = -(Math.abs(updates.balance));
        } else {
            updates.creditLimit = firebase.firestore.FieldValue.delete();
            updates.statementDay = firebase.firestore.FieldValue.delete();
            updates.dueDay = firebase.firestore.FieldValue.delete();
            updates.minimumPaymentRate = firebase.firestore.FieldValue.delete();
        }
        if (isInvestment) {
            updates.quantity = quantity;
            updates.buyPrice = buyPrice;
            if (!account || !account.openingRate) {
                updates.openingRate = buyPrice;
                updates.openingRateDate = new Date().toISOString();
            }
        } else {
            updates.quantity = firebase.firestore.FieldValue.delete();
            updates.buyPrice = firebase.firestore.FieldValue.delete();
            updates.openingRate = firebase.firestore.FieldValue.delete();
            updates.openingRateDate = firebase.firestore.FieldValue.delete();
        }

        try {
            await db.collection('users').doc(currentUser.uid).collection('accounts').doc(id).update(updates);
            document.getElementById('editAccountModal').style.display = 'none';
            showToast('Hesap güncellendi!', 'success');
            await loadUserData();
        } catch (error) {
            showToast('Hesap güncellenemedi: ' + error.message, 'error');
        }
    });

    // Hesap türü
    document.getElementById('accountType').addEventListener('change', (e) => {
        const balanceInput = document.getElementById('accountBalance');
        const hintText = document.getElementById('balanceHint');
        const creditDetails = document.getElementById('creditCardDetails');
        const creditInputs = creditDetails.querySelectorAll('input');
        if (e.target.value === 'credit' || e.target.value === 'debt') {
            balanceInput.min = "-1000000";
            balanceInput.placeholder = "0.00 (Borç için negatif girin)";
            hintText.textContent = e.target.value === 'debt'
                ? "Borç tutarı için negatif değer girin (örn: -1500)"
                : "Kredi kartı borcu için negatif değer girin (örn: -1500)";
            hintText.style.color = "#f44336";
        } else {
            balanceInput.removeAttribute('min');
            balanceInput.placeholder = "0.00";
            hintText.textContent = "Pozitif bakiye girin (0 olabilir)";
            hintText.style.color = "";
        }
        const isCredit = e.target.value === 'credit';
        creditDetails.hidden = !isCredit;
        creditInputs.forEach(input => { input.required = isCredit; });
    });
    document.getElementById('editAccountType').addEventListener('change', updateEditAccountFields);
    document.getElementById('isInstallment').addEventListener('change', (e) => {
        document.getElementById('installmentOptions').hidden = !e.target.checked;
    });

    // İşlem tipi
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            selectedType = e.target.closest('.type-btn').dataset.type;
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            e.target.closest('.type-btn').classList.add('active');
            updateCategorySelect();
        });
    });

    document.getElementById('accountSelect').addEventListener('change', updateAccountRateInfo);

    // Kategoriler
    const categories = {
        expense: ['🍔 Yemek','🚗 Ulaşım','🏠 Kira','💡 Faturalar','🛒 Market','🎮 Eğlence','💊 Sağlık','📚 Eğitim','👕 Giyim','📱 Teknoloji','🎁 Hediyeler','📋 Diğer'],
        income: ['💰 Maaş','💼 Serbest Çalışma','📈 Yatırım','🎁 Hediye','🏠 Kira Geliri','📋 Diğer']
    };
    function updateCategorySelect() {
        const select = document.getElementById('category');
        if (!select) return;
        select.innerHTML = '<option value="">Kategori Seçin</option>';
        categories[selectedType].forEach(category => { select.innerHTML += `<option value="${category}">${category}</option>`; });
    }
    updateCategorySelect();

    // İşlem formu
    document.getElementById('transactionForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        const accountId = document.getElementById('accountSelect').value;
        const amount = parseFloat(document.getElementById('amount').value);
        const account = accounts.find(a => a.id === accountId);
        if (!accountId || !amount || !account) { showToast('Lütfen geçerli bir hesap ve tutar seçin!', 'error'); return; }
        const isInvestment = isInvestmentAccount(account);
        const purchaseRate = isInvestment
            ? parseFloat(document.getElementById('transactionPurchaseRate').value)
            : 0;
        if (isInvestment && !(purchaseRate > 0)) {
            showToast('Döviz/altın işlemi için alış fiyatını girin.', 'error');
            return;
        }
        const openingRate = getAccountOpeningRate(account);
        const isRecurring = document.getElementById('isRecurring').checked;
        const frequency = document.getElementById('recurringFrequency').value;
        const endDate = document.getElementById('recurringEndDate').value || null;
        const transactionDate = document.getElementById('date').value;
        const isInstallment = account?.type === 'credit' && document.getElementById('isInstallment').checked;
        const installmentCount = isInstallment ? Math.max(2, parseInt(document.getElementById('installmentCount').value, 10) || 2) : 1;
        const installmentInterestRate = isInstallment
            ? Math.min(100, Math.max(0, parseFloat(document.getElementById('installmentInterestRate').value) || 0))
            : 0;
        const installmentInterestAmount = isInstallment ? amount * installmentInterestRate / 100 : 0;
        const installmentTotal = amount + installmentInterestAmount;
        const installmentAmount = isInstallment ? installmentTotal / installmentCount : amount;
        if (isRecurring && endDate && endDate < transactionDate) {
            showToast('Tekrarlayan işlemin bitiş tarihi başlangıç tarihinden önce olamaz.', 'error');
            return;
        }
        if (isRecurring && !frequency) {
            showToast('Tekrarlayan işlem sıklığını seçin.', 'error');
            return;
        }
        const transactionRate = isInvestmentAccount(account)
            ? Number(exchangeRates[account.currency] || openingRate)
            : 0;
        const profitLoss = isInvestment && transactionRate > 0
            ? (transactionRate - purchaseRate) * amount
            : 0;
        try {
            if (editingTransactionId) {
                const oldTransaction = transactions.find(item => item.id === editingTransactionId);
                if (!oldTransaction) throw new Error('Düzenlenecek işlem bulunamadı.');
                const oldAccount = accounts.find(item => item.id === oldTransaction.accountId);
                const oldImpact = oldTransaction.type === 'income'
                    ? Number(oldTransaction.amount || 0)
                    : Number(oldTransaction.isInstallment ? oldTransaction.installmentTotal || oldTransaction.amount : oldTransaction.amount || 0);
                const newImpact = selectedType === 'income' ? amount : (isInstallment ? installmentTotal : amount);
                const recurringCollection = db.collection('users').doc(currentUser.uid).collection('recurringTransactions');
                const oldRecurring = recurringTransactions.find(item => item.id === oldTransaction.recurringId)
                    || recurringTransactions.find(item => item.accountId === oldTransaction.accountId
                        && item.description === oldTransaction.description
                        && Number(item.amount) === Number(oldTransaction.amount));
                const recurringRef = isRecurring
                    ? (oldRecurring ? recurringCollection.doc(oldRecurring.id) : recurringCollection.doc())
                    : null;
                const transactionData = {
                    type: selectedType,
                    amount,
                    category: document.getElementById('category').value,
                    description: document.getElementById('description').value || 'Açıklama yok',
                    date: transactionDate,
                    accountId,
                    accountName: account.name,
                    accountCurrency: account.currency,
                    accountOpeningRate: getAccountOpeningRate(account),
                    accountOpeningRateDate: account.openingRateDate || null,
                    purchaseRate,
                    transactionRate,
                    transactionRateDate: new Date().toISOString(),
                    profitLoss,
                    isInstallment,
                    installmentCount,
                    installmentInterestRate,
                    installmentInterestAmount,
                    installmentTotal,
                    installmentAmount,
                    receiptBase64: oldTransaction.receiptBase64 || null,
                    recurringId: recurringRef ? recurringRef.id : firebase.firestore.FieldValue.delete(),
                    isRecurringSource: Boolean(recurringRef)
                };
                const batch = db.batch();
                batch.update(db.collection('users').doc(currentUser.uid).collection('transactions').doc(editingTransactionId), transactionData);
                if (recurringRef) {
                    batch.set(recurringRef, {
                        type: selectedType,
                        amount,
                        category: transactionData.category,
                        description: transactionData.description,
                        accountId,
                        accountName: account.name,
                        accountCurrency: account.currency,
                        purchaseRate,
                        frequency,
                        nextDate: oldRecurring?.nextDate || getNextRecurringDate(transactionDate, frequency),
                        endDate,
                        active: true,
                        isInstallment,
                        installmentCount,
                        installmentInterestRate,
                        installmentInterestAmount,
                        installmentTotal,
                        installmentAmount,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdAt: oldRecurring?.createdAt || firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                } else if (oldRecurring) {
                    batch.update(recurringCollection.doc(oldRecurring.id), { active: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                }
                if (oldAccount && oldAccount.id === account.id) {
                    const restoredBalance = Number(oldAccount.balance || 0) + (oldTransaction.type === 'income' ? -oldImpact : oldImpact);
                    const adjustedBalance = restoredBalance + (selectedType === 'income' ? newImpact : -newImpact);
                    const accountUpdates = { balance: adjustedBalance };
                    if (isInvestment) accountUpdates.quantity = adjustedBalance;
                    batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(account.id), accountUpdates);
                } else {
                    if (oldAccount) {
                        const oldBalance = Number(oldAccount.balance || 0) + (oldTransaction.type === 'income' ? -oldImpact : oldImpact);
                        batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(oldAccount.id), { balance: oldBalance });
                    }
                    const newBalance = Number(account.balance || 0) + (selectedType === 'income' ? newImpact : -newImpact);
                    const accountUpdates = { balance: newBalance };
                    if (isInvestment) accountUpdates.quantity = newBalance;
                    batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(account.id), accountUpdates);
                }
                try {
                    await batch.commit();
                } catch (error) {
                    if (error.code === 'permission-denied') {
                        throw new Error('Kayıtlı işlem yazma izni reddedildi. Firestore kurallarında recurringTransactions yazma izni gerekli.');
                    }
                    throw error;
                }
                if (recurringRef) {
                    const recurringData = {
                        id: recurringRef.id,
                        type: selectedType,
                        amount,
                        category: transactionData.category,
                        description: transactionData.description,
                        accountId,
                        accountName: account.name,
                        accountCurrency: account.currency,
                        purchaseRate,
                        frequency,
                        nextDate: oldRecurring?.nextDate || getNextRecurringDate(transactionDate, frequency),
                        endDate,
                        active: true,
                        isInstallment,
                        installmentCount,
                        installmentInterestRate,
                        installmentInterestAmount,
                        installmentTotal,
                        installmentAmount
                    };
                    recurringTransactions = recurringTransactions.filter(item => item.id !== recurringRef.id);
                    recurringTransactions.push(recurringData);
                } else if (oldRecurring) {
                    recurringTransactions = recurringTransactions.map(item => item.id === oldRecurring.id ? { ...item, active: false } : item);
                }
                editingTransactionId = null;
                document.getElementById('transactionForm').reset();
                document.getElementById('date').value = new Date().toISOString().split('T')[0];
                document.getElementById('recurringOptions').hidden = true;
                document.getElementById('installmentOptions').hidden = true;
                document.getElementById('creditInstallmentDetails').hidden = true;
                document.getElementById('transactionSubmitBtn').innerHTML = '<i class="fas fa-save"></i> Kaydet';
                showToast('İşlem güncellendi!', 'success');
                await loadUserData();
                return;
            }
            const transactionRef = db.collection('users').doc(currentUser.uid).collection('transactions').doc();
            await transactionRef.set({
                type: selectedType,
                amount,
                category: document.getElementById('category').value,
                description: document.getElementById('description').value || 'Açıklama yok',
                date: document.getElementById('date').value,
                accountId,
                accountName: account?.name || 'Bilinmeyen',
                accountCurrency: account?.currency || 'TRY',
                accountOpeningRate: getAccountOpeningRate(account),
                accountOpeningRateDate: account?.openingRateDate || null,
                purchaseRate,
                transactionRate,
                transactionRateDate: new Date().toISOString(),
                profitLoss,
                isInstallment,
                installmentCount,
                installmentInterestRate,
                installmentInterestAmount,
                installmentTotal,
                installmentAmount,
                receiptBase64: receiptBase64 || null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isRecurringSource: isRecurring
            });
            if (account) {
                const balanceAmount = isInstallment && selectedType === 'expense' ? installmentTotal : amount;
                const newBalance = selectedType === 'income' ? account.balance + balanceAmount : account.balance - balanceAmount;
                const updates = { balance: newBalance };
                if (isInvestment) {
                    updates.quantity = newBalance;
                    if (selectedType === 'income') {
                        const oldQuantity = Number(account.quantity ?? account.balance ?? 0);
                        const oldRate = getAccountOpeningRate(account);
                        updates.buyPrice = oldQuantity > 0
                            ? ((oldQuantity * oldRate) + (amount * purchaseRate)) / newBalance
                            : purchaseRate;
                        updates.openingRate = updates.buyPrice;
                    }
                }
                await db.collection('users').doc(currentUser.uid).collection('accounts').doc(accountId).update(updates);
            }
            if (isRecurring) {
                const recurringData = {
                    type: selectedType,
                    amount,
                    category: document.getElementById('category').value,
                    description: document.getElementById('description').value || 'Tekrarlayan işlem',
                    accountId,
                    accountName: account.name,
                    accountCurrency: account.currency,
                    purchaseRate,
                    frequency,
                    nextDate: getNextRecurringDate(transactionDate, frequency),
                    endDate,
                    active: true,
                    isInstallment,
                    installmentCount,
                    installmentInterestRate,
                    installmentInterestAmount,
                    installmentTotal,
                    installmentAmount,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                const recurringRef = db.collection('users').doc(currentUser.uid).collection('recurringTransactions').doc();
                try {
                    await recurringRef.set(recurringData);
                    await transactionRef.update({ recurringId: recurringRef.id, isRecurringSource: true });
                } catch (error) {
                    if (error.code === 'permission-denied') {
                        throw new Error('İşlem kaydedildi ancak kayıtlı işlemler için Firestore yazma izni yok.');
                    }
                    throw error;
                }
                recurringTransactions.push({ id: recurringRef.id, ...recurringData, createdAt: new Date().toISOString() });
                updateRecurringTransactionsUI();
            }
            document.getElementById('transactionForm').reset();
            document.getElementById('date').value = new Date().toISOString().split('T')[0];
            document.getElementById('recurringOptions').hidden = true;
            document.getElementById('installmentOptions').hidden = true;
            document.getElementById('creditInstallmentDetails').hidden = true;
            document.getElementById('creditCardDetails').hidden = true;
            updateTransactionPurchaseFields();
            document.getElementById('receiptPreview').innerHTML = '';
            receiptBase64 = null;
            showToast('İşlem kaydedildi!', 'success');
            await loadUserData();
        } catch (error) { showToast('İşlem hatası: ' + error.message, 'error'); }
    });

    // Transfer formu - kredi kartına ödemeyi masraf olarak ekle
    document.getElementById('transferForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        const fromAccountId = document.getElementById('fromAccount').value;
        const toAccountId = document.getElementById('toAccount').value;
        const amount = parseFloat(document.getElementById('transferAmount').value);
        if (!Number.isFinite(amount) || amount <= 0) {
            showToast('Transfer tutarı sıfırdan büyük olmalı.', 'error');
            return;
        }
        if (fromAccountId === toAccountId) { showToast('Kaynak ve hedef hesap aynı olamaz!', 'error'); return; }
        const fromAccount = accounts.find(a => a.id === fromAccountId);
        const toAccount = accounts.find(a => a.id === toAccountId);
        if (!fromAccount || !toAccount) { showToast('Hesaplar bulunamadı!', 'error'); return; }
        if (Number(fromAccount.balance || 0) < amount) { showToast('Yetersiz bakiye!', 'error'); return; }
        const isCreditCard = toAccount.type === 'credit' || toAccount.name.toLowerCase().includes('kredi');
        console.log('Kredi kartı mı?', isCreditCard);
        try {
            const batch = db.batch();
            const transferRef = db.collection('users').doc(currentUser.uid).collection('transfers').doc();
            batch.set(transferRef, {
                fromAccountId,
                fromAccountName: fromAccount.name,
                toAccountId,
                toAccountName: toAccount.name,
                toAccountType: toAccount.type,
                amount,
                description: document.getElementById('transferDescription').value || 'Hesap Transferi',
                date: document.getElementById('transferDate').value,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(fromAccountId), { balance: Number(fromAccount.balance || 0) - amount });
            batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(toAccountId), { balance: Number(toAccount.balance || 0) + amount });
            if (isCreditCard) {
                const paymentRef = db.collection('users').doc(currentUser.uid).collection('transactions').doc();
                batch.set(paymentRef, {
                    type: 'expense',
                    amount: amount,
                    category: '💳 Kredi Kartı Ödemesi',
                    description: `${fromAccount.name} → ${toAccount.name}`,
                    date: document.getElementById('transferDate').value,
                    accountId: fromAccountId,
                    accountName: fromAccount.name,
                    accountCurrency: fromAccount.currency || 'TRY',
                    transferId: transferRef.id,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            await batch.commit();
            document.getElementById('transferForm').reset();
            document.getElementById('transferDate').value = new Date().toISOString().split('T')[0];
            showToast('Transfer başarılı!', 'success');
            await loadUserData();
        } catch (error) { showToast('Transfer hatası: ' + error.message, 'error'); }
    });

    // Filtreler
    document.getElementById('filterType').addEventListener('change', updateTransactionsUI);
    document.getElementById('filterAccount').addEventListener('change', updateTransactionsUI);

    // Para birimi
    document.getElementById('currencySetting').addEventListener('change', async (e) => {
        currentCurrency = e.target.value;
        await saveSettings();
        showToast('Para birimi güncellendi!', 'success');
    });

    // Yeni ay başlat
    document.getElementById('startNewMonth').addEventListener('click', async () => {
        if (!confirm('Yeni ay başlatılacak. Emin misiniz?')) return;
        const now = new Date();
        currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        document.getElementById('currentMonthDisplay').textContent = formatMonth(currentMonth);
        await saveSettings();
        updateDashboard();
        showToast('Yeni ay başlatıldı!', 'success');
    });

    // Dışa aktar, içe aktar, sil
    document.getElementById('exportData').addEventListener('click', exportData);
    document.getElementById('importData').addEventListener('change', (e) => {
        const file = e.target.files[0];
        document.getElementById('importFileName').textContent = file ? file.name : 'Henüz dosya seçilmedi';
        importData(file);
    });
    document.getElementById('clearData').addEventListener('click', clearAllData);
    document.getElementById('saveRateAlerts').addEventListener('click', () => {
        if (!currentUser) return;
        const settings = loadRateAlertSettings();
        let invalidLimit = false;
        rateAlertCurrencies.forEach(currency => {
            const lowerValue = document.getElementById(`alertLower${currency}`).value.trim();
            const upperValue = document.getElementById(`alertUpper${currency}`).value.trim();
            const lower = lowerValue === '' ? null : Number(lowerValue);
            const upper = upperValue === '' ? null : Number(upperValue);
            if ((lower !== null && (!Number.isFinite(lower) || lower < 0)) || (upper !== null && (!Number.isFinite(upper) || upper < 0)) || (lower !== null && upper !== null && lower >= upper)) {
                invalidLimit = true;
                return;
            }
            settings.limits[currency] = { lower, upper };
            settings.states[currency] = 'normal';
        });
        if (invalidLimit) {
            showToast('Kur limitleri geçerli ve sıfırdan büyük olmalı.', 'error');
            return;
        }
        settings.frequencyHours = Number(document.getElementById('rateAlertFrequency').value) || 6;
        saveRateAlertSettings(settings);
        showToast('Kur bildirimleri kaydedildi.', 'success');
        checkRateAlerts();
    });
    document.getElementById('saveSecurityPin').addEventListener('click', async () => {
        const input = document.getElementById('securityPin');
        const pin = input.value.trim();
        if (!/^\d{4,8}$/.test(pin)) {
            showToast('PIN 4-8 haneli rakamlardan oluşmalı.', 'error');
            return;
        }
        localStorage.setItem(securityStorageKey('pin'), await hashSecurityPin(pin));
        input.value = '';
        await configureSecurityUI();
        showToast('Uygulama PIN kilidi etkinleştirildi.', 'success');
    });
    document.getElementById('removeSecurityPin').addEventListener('click', () => {
        if (!hasSecurityPin()) {
            showToast('Kayıtlı bir PIN bulunmuyor.', 'error');
            return;
        }
        localStorage.removeItem(securityStorageKey('pin'));
        localStorage.removeItem(securityStorageKey('locked'));
        securityLocked = false;
        if (securityTimeoutId) clearTimeout(securityTimeoutId);
        showToast('PIN kilidi kaldırıldı.', 'success');
    });
    document.getElementById('securityTimeout').addEventListener('change', (event) => {
        localStorage.setItem(securityStorageKey('timeout'), String(Number(event.target.value) || 0));
        scheduleSecurityLock();
        showToast('Otomatik kilit ayarı güncellendi.', 'success');
    });
    document.getElementById('lockNow').addEventListener('click', () => {
        if (!hasSecurityPin()) {
            showToast('Önce bir PIN kaydetmelisiniz.', 'error');
            return;
        }
        lockSecurityApp();
    });
    document.getElementById('unlockForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = document.getElementById('unlockPin');
        const error = document.getElementById('unlockError');
        const expected = localStorage.getItem(securityStorageKey('pin'));
        if (expected && await hashSecurityPin(input.value.trim()) === expected) {
            unlockSecurityApp();
            return;
        }
        input.value = '';
        error.textContent = 'PIN kodu hatalı.';
        input.focus();
    });

    // Hedefler
    document.getElementById('addGoalBtn').addEventListener('click', () => {
        updateGoalAccountSelect();
        document.getElementById('addGoalModal').style.display = 'flex';
    });
    document.getElementById('cancelGoal').addEventListener('click', () => { document.getElementById('addGoalModal').style.display = 'none'; });
    document.getElementById('goalForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        try {
            await db.collection('users').doc(currentUser.uid).collection('goals').add({
                name: document.getElementById('goalName').value,
                amount: parseFloat(document.getElementById('goalAmount').value),
                current: parseFloat(document.getElementById('goalCurrent').value) || 0,
                accountId: document.getElementById('goalAccount').value || null,
                accountName: accounts.find(account => account.id === document.getElementById('goalAccount').value)?.name || null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            document.getElementById('goalForm').reset();
            document.getElementById('addGoalModal').style.display = 'none';
            showToast('Hedef eklendi!', 'success');
            await loadUserData();
        } catch (error) { showToast('Hedef eklenirken hata: ' + error.message, 'error'); }
    });

    // Tema renkleri
    document.querySelectorAll('.theme-swatch').forEach(swatch => swatch.addEventListener('click', async () => {
        applyThemeColor(swatch.dataset.colorValue);
        await saveSettings();
        showToast('Renk teması güncellendi!', 'success');
    }));
    document.getElementById('applyRgbColor').addEventListener('click', async () => {
        const values = ['themeRed', 'themeGreen', 'themeBlue'].map(id => Number(document.getElementById(id).value));
        if (values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
            showToast('RGB değerleri 0 ile 255 arasında olmalı.', 'error');
            return;
        }
        const hexColor = `#${values.map(value => value.toString(16).padStart(2, '0')).join('')}`;
        applyThemeColor(hexColor);
        await saveSettings();
        showToast('Özel RGB teması uygulandı!', 'success');
    });

    // Tarihleri ayarla
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    document.getElementById('transferDate').value = new Date().toISOString().split('T')[0];

    // Tema
    const savedTheme = localStorage.getItem('theme-v2') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    document.querySelector('#themeBtn i').className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';

    // Kurları göster
    updateExchangeRatesDisplay();
    document.getElementById('currentMonthDisplay').textContent = formatMonth(currentMonth);
    
    console.log('✅ Uygulama hazır');
});
