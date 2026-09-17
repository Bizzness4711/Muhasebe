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


