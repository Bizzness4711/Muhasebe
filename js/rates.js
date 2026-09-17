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
        if (typeof updateSellFields === 'function') updateSellFields();
        if (typeof updateTransactionPurchaseFields === 'function') updateTransactionPurchaseFields();
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
    if (typeof updateSellFields === 'function') updateSellFields();
    if (typeof updateTransactionPurchaseFields === 'function') updateTransactionPurchaseFields();
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
    const isInvest = isInvestmentAccount(account);
    const sellBtn = document.getElementById('sellTypeBtn');
    if (sellBtn) sellBtn.style.display = isInvest ? '' : 'none';
    if (!isInvest && selectedType === 'sell') {
        selectedType = 'expense';
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        const expenseBtn = document.querySelector('.type-btn[data-type="expense"]');
        if (expenseBtn) expenseBtn.classList.add('active');
        updateCategorySelect();
    }
    updateSellFields();
    if (!details || !input || !label) return;
    details.hidden = !(isInvest && selectedType !== 'sell');
    input.required = isInvest && selectedType !== 'sell';
    if (isInvest && selectedType !== 'sell') {
        const currentRate = Number(exchangeRates[account.currency] || 0);
        label.textContent = `${account.currency === 'GRAM_ALTIN' ? 'Gram altını' : account.currency === 'CEYREK_ALTIN' ? 'Çeyrek altını' : account.currency} bu işlemde kaça aldınız? (₺)`;
        document.getElementById('transactionPurchaseHint').textContent =
            currentRate > 0 ? `Güncel kur: ₺${currentRate.toFixed(2)}. Aradaki fark kâr/zarar olarak hesaplanır.` : 'Güncel kur alınamadı; yine de alış fiyatını girin.';
    } else {
        input.value = '';
    }
}

function updateSellFields() {
    const accountSelect = document.getElementById('accountSelect');
    const sellDetails = document.getElementById('transactionSellDetails');
    const sellTargetGroup = document.getElementById('transactionSellTargetGroup');
    const sellRateInput = document.getElementById('transactionSellRate');
    const sellTargetSelect = document.getElementById('transactionSellTarget');
    const account = accounts.find(item => item.id === accountSelect?.value);
    const isInvest = isInvestmentAccount(account);
    const showSell = isInvest && selectedType === 'sell';
    if (sellDetails) {
        sellDetails.hidden = !showSell;
        if (sellRateInput) sellRateInput.required = showSell;
    }
    if (sellTargetGroup) {
        sellTargetGroup.hidden = !showSell;
        if (sellTargetSelect) sellTargetSelect.required = showSell;
    }
    if (showSell && sellRateInput) {
        const currentRate = Number(exchangeRates[account?.currency] || 0);
        const lbl = document.getElementById('transactionSellLabel');
        if (lbl) {
            const curName = account?.currency === 'GRAM_ALTIN' ? 'Gram altını' : account?.currency === 'CEYREK_ALTIN' ? 'Çeyrek altını' : account?.currency;
            lbl.textContent = `${curName} kaça satıldı? (₺)`;
        }
        const hint = document.getElementById('transactionSellHint');
        if (hint) {
            hint.textContent = currentRate > 0 ? `Güncel kur: ₺${currentRate.toFixed(2)}. Alış-satış farkı kâr/zarar olur.` : 'Güncel kur alınamadı; satış fiyatını girin.';
        }
    }
    if (showSell && sellTargetSelect) {
        const TRYAccounts = accounts.filter(a => a.currency === 'TRY' && a.id !== account?.id);
        sellTargetSelect.innerHTML = '<option value="">Hesap seçin</option>' +
            TRYAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        if (TRYAccounts.length === 1) sellTargetSelect.value = TRYAccounts[0].id;
    }
}

