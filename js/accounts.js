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

        // E-posta doğrulanmamışsa banner göster (erişi engelleme — ponytail: Firebase Console yapılandırması gerektirir)
        const verifyBanner = document.getElementById('emailVerifyBanner');
        if (verifyBanner) {
            if (!user.emailVerified) {
                verifyBanner.hidden = false;
                const resendBtn = verifyBanner.querySelector('.verify-resend-btn');
                if (resendBtn) {
                    resendBtn.onclick = async () => {
                        try {
                            await user.sendEmailVerification();
                            showToast('Doğrulama e-postası tekrar gönderildi.', 'success');
                        } catch (e) {
                            showToast('E-posta gönderilemedi: ' + e.message, 'error');
                        }
                    };
                }
                const dismissBtn = verifyBanner.querySelector('.verify-dismiss-btn');
                if (dismissBtn) {
                    dismissBtn.onclick = () => { verifyBanner.hidden = true; };
                }
            } else {
                verifyBanner.hidden = true;
            }
        }

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
        await loadCategories();
        await loadNotifications();
        updateAllUI();
        if (typeof refreshSprint1Dashboard === 'function') refreshSprint1Dashboard();
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
    updateCategorySelect();
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

