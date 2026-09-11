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

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i><span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
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
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Kişisel Muhasebe', { body: message });
}

function updateNotificationsUI() {
    const list = document.getElementById('notificationList');
    const count = document.getElementById('notificationCount');
    if (!list || !count) return;
    const unread = notifications.filter(item => !item.read);
    count.textContent = unread.length > 99 ? '99+' : String(unread.length);
    count.hidden = unread.length === 0;
    list.innerHTML = notifications.length
        ? notifications.slice(0, 12).map(item => `<div class="notification-item"><i class="fas ${item.icon}"></i><span>${item.message}</span></div>`).join('')
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

    function getNextRecurringDate(dateString, frequency) {
        const date = new Date(`${dateString}T12:00:00`);
        if (frequency === 'weekly') date.setDate(date.getDate() + 7);
        else if (frequency === 'yearly') date.setFullYear(date.getFullYear() + 1);
        else date.setMonth(date.getMonth() + 1);
        return date.toISOString().split('T')[0];
    }

    async function processRecurringTransactions() {
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
                const purchaseRate = Number(recurring.purchaseRate || 0);
                const transactionRate = isInvestmentAccount(account) ? Number(exchangeRates[account.currency] || getAccountOpeningRate(account)) : 0;
                const profitLoss = isInvestmentAccount(account) && transactionRate > 0 && purchaseRate > 0
                    ? (transactionRate - purchaseRate) * amount
                    : 0;
                await db.collection('users').doc(currentUser.uid).collection('transactions').add({
                    type: recurring.type, amount, category: recurring.category, description: recurring.description,
                    date: nextDate, accountId: account.id, accountName: account.name, accountCurrency: account.currency,
                    accountOpeningRate: getAccountOpeningRate(account), purchaseRate, transactionRate,
                    transactionRateDate: new Date().toISOString(), profitLoss, recurringId: document.id,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                const newBalance = recurring.type === 'income' ? Number(account.balance) + amount : Number(account.balance) - amount;
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

function signedReportValue(value) {
    const className = value >= 0 ? 'report-positive' : 'report-negative';
    return `<span class="${className}">${value >= 0 ? '+' : '-'}₺${Math.abs(value).toFixed(2)}</span>`;
}

function updateAdvancedReports() {
    const netWorthEl = document.getElementById('advancedNetWorth');
    const cashFlowEl = document.getElementById('advancedCashFlow');
    const profitLossEl = document.getElementById('advancedProfitLoss');
    const cashBody = document.getElementById('cashFlowReportBody');
    const categoryBody = document.getElementById('categoryComparisonBody');
    if (!netWorthEl || !cashFlowEl || !profitLossEl || !cashBody || !categoryBody) return;

    const netWorth = accounts.reduce((sum, account) => sum + getAccountValueTL(account), 0);
    const totalProfitLoss = accounts.filter(isInvestmentAccount).reduce((sum, account) => sum + getInvestmentMetrics(account).profitLoss, 0)
        + transactions.filter(transaction => transaction.type === 'expense').reduce((sum, transaction) => sum + Number(transaction.profitLoss || 0), 0);
    const currentTransactions = transactions.filter(transaction => transaction.date?.startsWith(currentMonth));
    const currentCashFlow = currentTransactions.reduce((sum, transaction) => sum + (transaction.type === 'income' ? 1 : -1) * getTransactionValueTL(transaction), 0);
    netWorthEl.textContent = isHidden ? '₺••••••' : `₺${netWorth.toFixed(2)}`;
    cashFlowEl.innerHTML = isHidden ? '₺••••••' : signedReportValue(currentCashFlow);
    profitLossEl.innerHTML = isHidden ? '₺••••••' : signedReportValue(totalProfitLoss);

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

    let year = Number(currentMonth.substring(0, 4));
    let month = Number(currentMonth.substring(5, 7)) - 1;
    const previousDate = new Date(year, month - 1, 1);
    const previousMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
    const categories = {};
    transactions.filter(transaction => transaction.type === 'expense').forEach(transaction => {
        const transactionMonth = transaction.date?.substring(0, 7);
        if (transactionMonth !== currentMonth && transactionMonth !== previousMonth) return;
        if (!categories[transaction.category]) categories[transaction.category] = { current: 0, previous: 0 };
        categories[transaction.category][transactionMonth === currentMonth ? 'current' : 'previous'] += getTransactionValueTL(transaction);
    });
    const categoryRows = Object.entries(categories).sort((a, b) => b[1].current - a[1].current);
    categoryBody.innerHTML = categoryRows.length ? categoryRows.map(([category, values]) => {
        const change = values.current - values.previous;
        return `<tr><td>${category}</td><td>₺${values.previous.toFixed(2)}</td><td>₺${values.current.toFixed(2)}</td><td>${signedReportValue(change)}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty-state">Karşılaştırılacak masraf verisi yok.</td></tr>';
}

function updateGoalAccountSelect() {
    const select = document.getElementById('goalAccount');
    if (!select) return;
    const currentValue = select.value;
    const tryAccounts = accounts.filter(account => account.currency === 'TRY');
    select.innerHTML = '<option value="">Hesap bağlama</option>' +
        tryAccounts.map(account => `<option value="${account.id}">${account.name} (${account.balance.toFixed(2)} ₺)</option>`).join('');
    if (tryAccounts.some(account => account.id === currentValue)) select.value = currentValue;
}

function updateRecurringTransactionsUI() {
    const list = document.getElementById('recurringTransactionsList');
    if (!list) return;
    const active = recurringTransactions.filter(item => item.active !== false);
    list.innerHTML = active.length ? active.map(item => `<div class="recurring-item">
        <span><strong>${item.type === 'income' ? 'Gelir' : 'Masraf'}</strong> · ${item.description} · ${Number(item.amount || 0).toFixed(2)} ${item.accountCurrency}</span>
        <small>Sonraki: ${item.nextDate}</small>
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
    return isInvestmentAccount(account) ? getInvestmentMetrics(account).currentValue : Number(account.balance || 0);
}

function updateEditAccountFields() {
    const currency = document.getElementById('editAccountCurrency').value;
    const isInvestment = investmentCurrencies.includes(currency);
    const typeSelect = document.getElementById('editAccountType');
    const balanceGroup = document.getElementById('editAccountBalanceGroup');
    const quantityInput = document.getElementById('editAccountQuantity');
    const buyPriceInput = document.getElementById('editAccountBuyPrice');

    document.getElementById('editInvestmentDetails').style.display = isInvestment ? 'block' : 'none';
    balanceGroup.style.display = isInvestment ? 'none' : 'block';
    quantityInput.required = isInvestment;
    buyPriceInput.required = isInvestment;
    typeSelect.disabled = isInvestment;
    if (isInvestment) typeSelect.value = 'investment';
    else if (typeSelect.value === 'investment') typeSelect.value = 'bank';
}

function updateDashboard() {
    const selectedAccountsList = accounts.filter(a => selectedAccounts.has(a.id) && a.currency === 'TRY');
    const totalBalance = selectedAccountsList.reduce((sum, a) => sum + getAccountValueTL(a), 0);

    const totalIncome = transactions.filter(t => t.type === 'income' && t.date.startsWith(currentMonth)).reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = transactions.filter(t => t.type === 'expense' && t.date.startsWith(currentMonth)).reduce((sum, t) => sum + t.amount, 0);
    const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome * 100) : 0;

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
    const monthDisplay = document.getElementById('currentMonthDisplay');

    if (isHidden) {
        if (totalBalanceEl) totalBalanceEl.textContent = totalBalanceVisible ? `₺${totalBalance.toFixed(2)}` : '₺••••••';
        if (totalIncomeEl) totalIncomeEl.textContent = '₺••••••';
        if (totalExpenseEl) totalExpenseEl.textContent = '₺••••••';
        if (savingsRateEl) savingsRateEl.textContent = '%••••';
        if (investmentSummaryEl) investmentSummaryEl.textContent = '₺••••••';
        if (investmentProfitLossEl) investmentProfitLossEl.textContent = 'Kâr/Zarar: ₺••••••';
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
    }

    if (monthDisplay) monthDisplay.textContent = formatMonth(currentMonth);

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
    else list.innerHTML = selectedAccountsList.map(account => `<div class="account-summary-item"><span>${account.name}</span><strong>₺${getAccountValueTL(account).toFixed(2)}</strong></div>`).join('');
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
    const typeIcons = { bank: '🏦', cash: '💵', credit: '💳', investment: '📈' };

    if (accountsList) {
        if (accounts.length === 0) accountsList.innerHTML = '<p class="empty-state">Henüz hesap eklenmemiş</p>';
        else {
            accountsList.innerHTML = accounts.map(account => {
                const investment = isInvestmentAccount(account);
                const metrics = investment ? getInvestmentMetrics(account) : null;
                const isNegative = investment ? metrics.profitLoss < 0 : account.balance < 0;
                const balanceDisplay = isHidden ? '₺••••••' : investment
                    ? `₺${metrics.currentValue.toFixed(2)}`
                    : `${currencySymbols[account.currency]} ${account.balance.toFixed(2)}`;
                const investmentDetail = investment && !isHidden
                    ? `<p class="investment-account-detail">${metrics.quantity} adet · Maliyet: ₺${metrics.cost.toFixed(2)} · ${metrics.profitLoss >= 0 ? 'Kâr' : 'Zarar'}: ${metrics.profitLoss >= 0 ? '+' : '-'}₺${Math.abs(metrics.profitLoss).toFixed(2)}</p>`
                    : '';
                const accountColor = /^#[0-9a-f]{6}$/i.test(account.color || '') ? account.color : '#4CAF50';
                const accountLabel = account.label ? `<span class="account-label" style="--account-color:${accountColor}">${account.label}</span>` : '';
                return `<div class="account-card" style="--account-color:${accountColor}; border-top: 4px solid var(--account-color);">
                    <div class="account-card-header">
                        <div class="account-card-type ${account.type}">${typeIcons[account.type] || '💰'}</div>
                        <div>
                            <button class="edit-account-btn" onclick="editAccount('${account.id}')" title="Hesabı Düzenle"><i class="fas fa-edit"></i></button>
                            <button class="delete-account-btn" onclick="deleteAccount('${account.id}')" title="Hesabı Sil"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <h3 class="account-card-title"><span>${account.name}</span>${accountLabel}</h3>
                    <p class="account-card-balance ${isNegative ? 'negative-balance' : ''}">${balanceDisplay}</p>
                    ${investmentDetail}
                </div>`;
            }).join('');
        }
    }

    const accountOptions = accounts.map(a => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('');
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
                    <input type="checkbox" value="${account.id}" ${isChecked ? 'checked' : ''} onchange="window.toggleAccountSelection('${account.id}', this.checked)">
                    <span class="checkmark"><i class="fas fa-check"></i></span>
                    <span>${account.name}</span>
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
    transactions.forEach(t => {
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
        const amountDisplay = isHidden ? '₺••••••' : `${sign}${currencySymbol}${(item.amount || 0).toFixed(2)}`;
         const purchaseRateDisplay = !isTransfer && item.purchaseRate > 0
            ? `<div class="transaction-rate-modern">Alış kuru: ${getCurrencyRateLabel(item.accountCurrency, item.purchaseRate)}</div>`
            : '';
        const transactionRateDisplay = !isTransfer && item.transactionRate > 0
            ? `<div class="transaction-rate-modern">İşlem kuru: ${getCurrencyRateLabel(item.accountCurrency, item.transactionRate)}</div>`
            : '';
        const profitLossDisplay = !isTransfer && item.profitLoss !== 0
            ? `<div class="transaction-rate-modern">${item.profitLoss > 0 ? 'Kâr' : 'Zarar'}: ${item.profitLoss > 0 ? '+' : '-'}₺${Math.abs(item.profitLoss).toFixed(2)}</div>`
            : '';
        
        let deleteBtn = '';
        if (item.isTransfer) deleteBtn = `<button class="delete-btn" onclick="deleteTransfer('${item.id}')"><i class="fas fa-trash"></i></button>`;
        else deleteBtn = `<button class="delete-btn" onclick="deleteTransaction('${item.id}')"><i class="fas fa-trash"></i></button>`;
        
        let receiptIcon = '';
        if (item.receiptBase64) receiptIcon = `<button class="receipt-link" onclick="showReceipt('${item.receiptBase64}')" title="Fişi Gör"><i class="fas fa-receipt"></i></button>`;
        
        return `<div class="transaction-card-modern">
            <div class="transaction-icon-modern ${amountClass}"><i class="fas ${icon}"></i></div>
            <div class="transaction-info-modern">
                <div class="transaction-title-modern">${item.category}</div>
                <div class="transaction-subtitle-modern">${item.description} • ${item.date}${purchaseRateDisplay}${transactionRateDisplay}${profitLossDisplay}</div>
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
}

function showReceipt(base64Data) {
    const win = window.open();
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
        const linkedAccount = goal.accountName ? `<small class="goal-linked-account"><i class="fas fa-link"></i> ${goal.accountName}</small>` : '';
        return `<div class="goal-card">
            <div class="goal-card-header"><div><h3>${goal.name}</h3>${linkedAccount}</div><button class="delete-goal-btn" onclick="deleteGoal('${goal.id}')"><i class="fas fa-trash"></i></button></div>
            <div class="goal-progress-bar"><div class="goal-progress-fill" style="width: ${percentage}%;"></div></div>
            <div class="goal-amounts"><span>${currentDisplay}</span><span class="goal-percentage">%${percentage}</span><span>${targetDisplay}</span></div>
            <button class="add-btn" style="margin-top:10px; width:100%; justify-content:center;" onclick="addToGoal('${goal.id}')"><i class="fas fa-plus"></i> Para Ekle</button>
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
            if (account) {
                const newBalance = transaction.type === 'income' ? account.balance - transaction.amount : account.balance + transaction.amount;
                const updates = { balance: newBalance };
                if (isInvestmentAccount(account)) {
                    updates.quantity = newBalance;
                    const transactionRate = Number(transaction.purchaseRate || transaction.accountOpeningRate || 0);
                    const currentRate = getAccountOpeningRate(account);
                    if (transactionRate > 0 && newBalance > 0) {
                        if (transaction.type === 'income') {
                            updates.buyPrice = ((Number(account.balance) * currentRate) - (transaction.amount * transactionRate)) / newBalance;
                        } else {
                            updates.buyPrice = ((Number(account.balance) * currentRate) + (transaction.amount * transactionRate)) / newBalance;
                        }
                        updates.openingRate = updates.buyPrice;
                    }
                }
                await db.collection('users').doc(currentUser.uid).collection('accounts').doc(account.id).update(updates);
            }
            await db.collection('users').doc(currentUser.uid).collection('transactions').doc(id).delete();
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
            if (fromAccount) await db.collection('users').doc(currentUser.uid).collection('accounts').doc(fromAccount.id).update({ balance: fromAccount.balance + transfer.amount });
            if (toAccount) await db.collection('users').doc(currentUser.uid).collection('accounts').doc(toAccount.id).update({ balance: toAccount.balance - transfer.amount });
            await db.collection('users').doc(currentUser.uid).collection('transfers').doc(id).delete();
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
    expenses.forEach(e => { categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount; });
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
        if (t.type === 'income') monthlyData[month].income += t.amount;
        else monthlyData[month].expense += t.amount;
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
        for (const collection of ['accounts', 'transactions', 'transfers', 'goals']) {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection(collection).get();
            for (const doc of snapshot.docs) await doc.ref.delete();
        }
        accounts = []; transactions = []; transfers = []; goals = [];
        updateAllUI();
        showToast('Tüm veriler silindi!', 'success');
    } catch (e) { showToast('Silme hatası: ' + e.message, 'error'); }
}

function exportData() {
    const data = { settings: { currency: currentCurrency, currentMonth: currentMonth, selectedAccounts: Array.from(selectedAccounts), themeColor: currentThemeColor }, accounts, transactions, transfers, goals };
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
            if (data.accounts) for (const account of data.accounts) { const { id, ...rest } = account; await db.collection('users').doc(currentUser.uid).collection('accounts').add(rest); }
            if (data.transactions) for (const tx of data.transactions) { const { id, ...rest } = tx; await db.collection('users').doc(currentUser.uid).collection('transactions').add(rest); }
            if (data.transfers) for (const tr of data.transfers) { const { id, ...rest } = tr; await db.collection('users').doc(currentUser.uid).collection('transfers').add(rest); }
            if (data.goals) for (const goal of data.goals) { const { id, ...rest } = goal; await db.collection('users').doc(currentUser.uid).collection('goals').add(rest); }
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
        document.getElementById('voiceResult').innerHTML = `<p><strong>Algılanan:</strong> "${transcript}"</p>`;
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
        preview.innerHTML += `<p><strong>Okunan Metin:</strong></p><pre style="white-space:pre-wrap; font-size:12px;">${text}</pre>`;
        
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
            if (page === 'reports') setTimeout(updateCharts, 500);
        });
    });

    document.getElementById('newTransactionBtn').addEventListener('click', () => {
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
        localStorage.setItem('theme', newTheme);
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
        if (e.target.value === 'credit') {
            balanceInput.min = "-1000000";
            balanceInput.placeholder = "0.00 (Borç için negatif girin)";
            hintText.textContent = "Kredi kartı borcu için negatif değer girin (örn: -1500)";
            hintText.style.color = "#f44336";
        } else {
            balanceInput.removeAttribute('min');
            balanceInput.placeholder = "0.00";
            hintText.textContent = "Pozitif bakiye girin (0 olabilir)";
            hintText.style.color = "";
        }
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
        if (!accountId || !amount) { showToast('Lütfen tüm alanları doldurun!', 'error'); return; }
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
        if (isRecurring && endDate && endDate < transactionDate) {
            showToast('Tekrarlayan işlemin bitiş tarihi başlangıç tarihinden önce olamaz.', 'error');
            return;
        }
        const transactionRate = isInvestmentAccount(account)
            ? Number(exchangeRates[account.currency] || openingRate)
            : 0;
        const profitLoss = isInvestment && transactionRate > 0
            ? (transactionRate - purchaseRate) * amount
            : 0;
        try {
            await db.collection('users').doc(currentUser.uid).collection('transactions').add({
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
                receiptBase64: receiptBase64 || null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if (account) {
                const newBalance = selectedType === 'income' ? account.balance + amount : account.balance - amount;
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
                try {
                    await db.collection('users').doc(currentUser.uid).collection('recurringTransactions').add({
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
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                } catch (error) {
                    if (error.code !== 'permission-denied') throw error;
                    showToast('İşlem kaydedildi; tekrarlayan işlem için Firestore izni gerekli.', 'error');
                }
            }
            document.getElementById('transactionForm').reset();
            document.getElementById('date').value = new Date().toISOString().split('T')[0];
            document.getElementById('recurringOptions').hidden = true;
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
        if (fromAccountId === toAccountId) { showToast('Kaynak ve hedef hesap aynı olamaz!', 'error'); return; }
        const fromAccount = accounts.find(a => a.id === fromAccountId);
        const toAccount = accounts.find(a => a.id === toAccountId);
        if (!fromAccount || !toAccount) { showToast('Hesaplar bulunamadı!', 'error'); return; }
        if (fromAccount.balance < amount) { showToast('Yetersiz bakiye!', 'error'); return; }
        const isCreditCard = toAccount.type === 'credit' || toAccount.name.toLowerCase().includes('kredi');
        console.log('Kredi kartı mı?', isCreditCard);
        try {
            await db.collection('users').doc(currentUser.uid).collection('transfers').add({
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
            await db.collection('users').doc(currentUser.uid).collection('accounts').doc(fromAccountId).update({ balance: fromAccount.balance - amount });
            await db.collection('users').doc(currentUser.uid).collection('accounts').doc(toAccountId).update({ balance: toAccount.balance + amount });
            if (isCreditCard) {
                await db.collection('users').doc(currentUser.uid).collection('transactions').add({
                    type: 'expense',
                    amount: amount,
                    category: '💳 Kredi Kartı Ödemesi',
                    description: `${fromAccount.name} → ${toAccount.name}`,
                    date: document.getElementById('transferDate').value,
                    accountId: fromAccountId,
                    accountName: fromAccount.name,
                    accountCurrency: fromAccount.currency || 'TRY',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                console.log('✅ Kredi kartı transferi masraf kaydı oluşturuldu');
            }
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
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    document.querySelector('#themeBtn i').className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';

    // Kurları göster
    updateExchangeRatesDisplay();
    document.getElementById('currentMonthDisplay').textContent = formatMonth(currentMonth);
    
    console.log('✅ Uygulama hazır');
});
