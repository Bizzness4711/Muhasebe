/**
 * Sprint 1 Features — Quick-Add, Velocity Alert, Category Bars, Autocomplete, Monthly Compare
 * ponytail: all-in-one file, split later if it exceeds 400 lines
 */

/* ==========================================================
   1. QUICK-ADD WIDGET
   ========================================================== */
let quickAddType = 'expense';

function initQuickAdd() {
    const fab = document.getElementById('quickAddBtn');
    const modal = document.getElementById('quickAddModal');
    const closeBtn = document.getElementById('closeQuickAdd');
    const form = document.getElementById('quickAddForm');
    const typeBtns = modal ? modal.querySelectorAll('.type-btn') : [];

    if (!fab || !modal) return;

    fab.addEventListener('click', () => {
        populateQuickAddSelects();
        modal.style.display = 'flex';
        const amt = document.getElementById('quickAddAmount');
        if (amt) amt.focus();
    });

    closeBtn && closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    typeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            typeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            quickAddType = btn.dataset.type;
        });
    });

    form && form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('quickAddAmount').value);
        const category = document.getElementById('quickAddCategory').value;
        const accountId = document.getElementById('quickAddAccount').value;
        if (!amount || !category || !accountId || !currentUser) return;

        const account = accounts.find(a => a.id === accountId);
        if (quickAddType === 'expense' && account && account.type !== 'credit' && !(account.name || '').toLowerCase().includes('kredi') && Number(account.balance || 0) < amount) {
            showToast(`Yetersiz bakiye! ${account.name} hesabında ₺${Number(account.balance || 0).toFixed(2)} var.`, 'error');
            return;
        }
        const today = new Date().toISOString().slice(0, 10);
        const tx = {
            type: quickAddType,
            amount,
            category,
            accountId,
            currency: account ? (account.currency || 'TRY') : 'TRY',
            description: '',
            date: today,
            createdAt: new Date().toISOString(),
            userId: currentUser.uid,
        };

        try {
            await db.collection('users').doc(currentUser.uid).collection('transactions').add(tx);
            // ponytail: islem bildirimi e-postasi kapali — kullanici istemedi
            showToast(quickAddType === 'income' ? 'Gelir eklendi!' : 'Masraf eklendi!', 'success');
            modal.style.display = 'none';
            form.reset();
            // re-activate expense button
            typeBtns.forEach(b => b.classList.remove('active'));
            const expBtn = modal.querySelector('[data-type="expense"]');
            if (expBtn) expBtn.classList.add('active');
            quickAddType = 'expense';
            await loadUserData();
        } catch (err) {
            showToast('Hata: ' + err.message, 'error');
        }
    });
}

function populateQuickAddSelects() {
    const catSel = document.getElementById('quickAddCategory');
    const accSel = document.getElementById('quickAddAccount');
    if (catSel) {
        const cats = getCategories(quickAddType);
        catSel.innerHTML = '<option value="">Kategori Seçin</option>' +
            cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
    if (accSel) {
        accSel.innerHTML = '<option value="">Hesap Seçin</option>' +
            accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    }
}

/* ==========================================================
   2. SPENDING VELOCITY ALERT
   ========================================================== */
function updateSpendingVelocity() {
    const card = document.getElementById('spendingVelocityCard');
    const msg = document.getElementById('velocityMessage');
    const warn = document.getElementById('velocityWarning');
    if (!card || !msg || !warn) return;

    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthStr = currentMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const monthExpenses = transactions.filter(t =>
        t.type === 'expense' && String(t.date || '').startsWith(monthStr)
    );
    const totalSpent = monthExpenses.reduce((s, t) => s + getTransactionValueTL(t), 0);
    const dailyRate = dayOfMonth > 0 ? totalSpent / dayOfMonth : 0;
    const projected = dailyRate * daysInMonth;

    // Find relevant budget
    const monthBudgets = budgets.filter(b => b.month === monthStr);
    const totalBudget = monthBudgets.reduce((s, b) => s + (Number(b.limit) || 0), 0);

    msg.textContent = `Bugün ₺${totalSpent.toFixed(0)} harcadın — bu hızla ay sonu ₺${projected.toFixed(0)} olacak.`;

    if (totalBudget > 0) {
        if (projected > totalBudget) {
            warn.textContent = `Bütçen ₺${totalBudget.toFixed(0)} — aşım riski var!`;
            card.classList.add('over-budget');
        } else {
            const remaining = totalBudget - totalSpent;
            warn.textContent = `Bütçen ₺${totalBudget.toFixed(0)} — ₺${remaining.toFixed(0)} kaldı.`;
            card.classList.remove('over-budget');
        }
        card.style.display = 'block';
    } else if (totalSpent > 0) {
        warn.textContent = 'Bütçe belirlenmemiş.';
        card.style.display = 'block';
        card.classList.remove('over-budget');
    } else {
        card.style.display = 'none';
    }
}

/* ==========================================================
   3. CATEGORY BUDGET PROGRESS BARS (dashboard overview)
   ========================================================== */
function updateCategoryBudgetBars() {
    const overview = document.getElementById('budgetOverview');
    const overviewCard = document.getElementById('budgetOverviewCard');
    if (!overview || !overviewCard) return;

    const monthStr = currentMonth || new Date().toISOString().slice(0, 7);
    const monthBudgets = budgets.filter(b => b.month === monthStr);

    if (!monthBudgets.length) {
        overviewCard.style.display = 'none';
        return;
    }

    overviewCard.style.display = 'block';
    overview.innerHTML = monthBudgets.map(b => {
        const limit = Number(b.limit) || 0;
        const spent = getBudgetSpent(b.category, b.month);
        const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
        const barClass = spent >= limit ? 'over' : pct >= 80 ? 'warn' : '';
        const hidden = isHidden ? '₺••••••' : `₺${spent.toFixed(0)} / ₺${limit.toFixed(0)}`;
        const amountClass = spent >= limit ? 'cat-amount over' : 'cat-amount';
        return `<div class="budget-category-bar">
            <span class="cat-name">${escapeHtml(b.category)}</span>
            <div class="goal-progress-bar"><div class="goal-progress-fill budget-fill ${barClass}" style="width:${pct.toFixed(1)}%"></div></div>
            <span class="${amountClass}">${hidden}</span>
        </div>`;
    }).join('');
}

/* ==========================================================
   4. MERCHANT AUTOCOMPLETE
   ========================================================== */
const MERCHANT_STORAGE_KEY = 'finora_merchant_history';

function getMerchantHistory() {
    try {
        return JSON.parse(localStorage.getItem(MERCHANT_STORAGE_KEY) || '[]');
    } catch { return []; }
}

function saveMerchantToHistory(desc) {
    if (!desc || desc.trim().length < 2) return;
    const history = getMerchantHistory();
    const clean = desc.trim();
    // increment count or add
    const existing = history.find(m => m.text === clean);
    if (existing) {
        existing.count = (existing.count || 1) + 1;
    } else {
        history.push({ text: clean, count: 1 });
    }
    // keep top 50 by frequency
    history.sort((a, b) => (b.count || 0) - (a.count || 0));
    localStorage.setItem(MERCHANT_STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
    refreshMerchantSuggestions();
}

function refreshMerchantSuggestions() {
    const dl = document.getElementById('merchantSuggestions');
    if (!dl) return;
    const history = getMerchantHistory();
    dl.innerHTML = history.map(m => `<option value="${escapeHtml(m.text)}">`).join('');
}

function initMerchantAutocomplete() {
    // Hook into existing transaction save — watch for description saves
    refreshMerchantSuggestions();
}

/* ==========================================================
   5. MONTHLY COMPARISON CARD
   ========================================================== */
function updateMonthlyComparison() {
    const card = document.getElementById('monthlyComparisonCard');
    const curExpEl = document.getElementById('currentMonthExpense');
    const lastExpEl = document.getElementById('lastMonthExpense');
    const diffEl = document.getElementById('expenseDiff');
    if (!card || !curExpEl || !lastExpEl || !diffEl) return;

    const now = new Date();
    const curMonth = currentMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // compute last month
    const [y, m] = curMonth.split('-').map(Number);
    const lastDate = new Date(y, m - 2, 1);
    const lastMonth = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}`;

    const curExpenses = transactions
        .filter(t => t.type === 'expense' && String(t.date || '').startsWith(curMonth))
        .reduce((s, t) => s + getTransactionValueTL(t), 0);

    const lastExpenses = transactions
        .filter(t => t.type === 'expense' && String(t.date || '').startsWith(lastMonth))
        .reduce((s, t) => s + getTransactionValueTL(t), 0);

    const diff = curExpenses - lastExpenses;

    curExpEl.textContent = `₺${curExpenses.toFixed(0)}`;
    lastExpEl.textContent = `₺${lastExpenses.toFixed(0)}`;
    diffEl.textContent = `${diff >= 0 ? '+' : ''}₺${diff.toFixed(0)}`;
    diffEl.className = 'comparison-diff ' + (diff > 0 ? 'negative' : diff < 0 ? 'positive' : '');

    card.style.display = 'block';
}

/* ==========================================================
   6. SPENDING RADAR CHART
   ========================================================== */
let spendingRadarChart = null;

const RADAR_COLORS = [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
    '#FF9F40', '#E7E9ED', '#7BC225', '#FF6B6B', '#48C6EF',
    '#6F86D6', '#F67280', '#C06C84', '#6C5B7B', '#355C7D'
];

function updateSpendingRadar() {
    if (typeof Chart === 'undefined') return;
    const card = document.getElementById('spendingRadarCard');
    const canvas = document.getElementById('spendingRadarChart');
    const legend = document.getElementById('radarLegend');
    if (!card || !canvas || !legend) return;

    const now = new Date();
    const monthStr = currentMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const monthExpenses = transactions.filter(t =>
        t.type === 'expense' && String(t.date || '').startsWith(monthStr)
    );

    if (!monthExpenses.length) {
        if (spendingRadarChart) { spendingRadarChart.destroy(); spendingRadarChart = null; }
        card.style.display = 'none';
        return;
    }

    card.style.display = 'block';

    const catTotals = {};
    monthExpenses.forEach(t => {
        const cat = t.category || 'Diğer';
        catTotals[cat] = (catTotals[cat] || 0) + (getTransactionValueTL(t) || 0);
    });

    const labels = Object.keys(catTotals);
    const data = Object.values(catTotals);
    const total = data.reduce((a, b) => a + b, 0);
    const maxVal = Math.max(...data);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
    const labelColor = isDark ? '#a6a7bb' : '#72758a';

    if (spendingRadarChart) {
        spendingRadarChart.data.labels = labels;
        spendingRadarChart.data.datasets[0].data = data;
        spendingRadarChart.options.scales.r.grid.color = gridColor;
        spendingRadarChart.options.scales.r.pointLabels.color = labelColor;
        spendingRadarChart.update();
    } else {
        spendingRadarChart = new Chart(canvas, {
            type: 'radar',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: 'rgba(98, 86, 217, 0.15)',
                    borderColor: '#6256d9',
                    borderWidth: 2,
                    pointBackgroundColor: RADAR_COLORS.slice(0, labels.length),
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 1,
                layout: { padding: { top: 20, bottom: 20, left: 20, right: 20 } },
                plugins: { legend: { display: false } },
                scales: {
                    r: {
                        beginAtZero: true,
                        suggestedMax: maxVal * 1.2,
                        grid: { color: gridColor },
                        angleLines: { color: gridColor },
                        pointLabels: {
                            color: labelColor,
                            padding: 16,
                            font: { size: 13, weight: '600' }
                        },
                        ticks: { display: false }
                    }
                }
            }
        });
    }

    legend.innerHTML = labels.map((l, i) => {
        const pct = total > 0 ? ((data[i] / total) * 100).toFixed(0) : 0;
        const dot = RADAR_COLORS[i % RADAR_COLORS.length];
        return `<div class="radar-legend-item">
            <span class="radar-legend-dot" style="background:${dot}"></span>
            <span class="radar-legend-label">${escapeHtml(l)}</span>
            <span class="radar-legend-pct">%${pct}</span>
            <span class="radar-legend-value">₺${data[i].toFixed(0)}</span>
        </div>`;
    }).join('');
}

/* ==========================================================
   7. BUDGET ALERT TOAST
   ========================================================== */
const _shownBudgetAlerts = new Set();

function checkBudgetAlerts() {
    const now = new Date();
    const monthStr = currentMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    budgets.forEach(b => {
        if (b.month !== monthStr) return;

        const key = `${b.id}-${b.month}`;
        if (_shownBudgetAlerts.has(key)) return;
        if (!b.limit || b.limit <= 0) return;

        const spent = getBudgetSpent(b.category, b.month);
        const pct = (spent / b.limit) * 100;

        if (pct >= 100) {
            const overspend = spent - b.limit;
            showToast(`🔴 ${b.category} bütçesi aşıldı! ₺${overspend.toFixed(0)} fazla harcandı.`, 'error');
            if (typeof sendBudgetAlertEmail === 'function') sendBudgetAlertEmail(b.category, pct, spent, b.limit, true);
        } else if (pct >= 80) {
            const remaining = b.limit - spent;
            showToast(`⚠️ ${b.category} bütçesinin %${pct.toFixed(0)} kullanıldı — ₺${remaining.toFixed(0)} kaldı!`, 'error');
            if (typeof sendBudgetAlertEmail === 'function') sendBudgetAlertEmail(b.category, pct, spent, b.limit, false);
        }

        _shownBudgetAlerts.add(key);
    });
}

/* ==========================================================
   8. GOAL PROGRESS RINGS (SVG)
   ========================================================== */
function updateGoalRings() {
    const card = document.getElementById('goalRingsCard');
    const container = document.getElementById('goalRings');
    if (!card || !container) return;

    if (!goals.length) { card.style.display = 'none'; return; }

    const top3 = goals
        .map(g => ({ ...g, pct: g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0 }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3);

    const colors = ['var(--primary-color)', 'var(--income-color)', 'var(--warning-color)'];
    const circumference = 2 * Math.PI * 50;

    container.innerHTML = top3.map((g, i) => {
        const offset = circumference - (g.pct / 100) * circumference;
        return `<div class="ring-item">
            <svg class="ring-svg" viewBox="0 0 120 120">
                <circle class="ring-bg" cx="60" cy="60" r="50" fill="none"/>
                <circle class="ring-fill" cx="60" cy="60" r="50" fill="none"
                    stroke="${colors[i % 3]}" stroke-dasharray="${circumference}"
                    stroke-dashoffset="${offset}" transform="rotate(-90 60 60)"/>
                <text x="60" y="60" text-anchor="middle" dominant-baseline="central"
                    class="ring-pct" fill="var(--text-color)">%${g.pct.toFixed(0)}</text>
            </svg>
            <div class="ring-label">${escapeHtml(g.name)}</div>
            <div class="ring-amount">₺${(g.current || 0).toFixed(0)} / ₺${(g.target || 0).toFixed(0)}</div>
        </div>`;
    }).join('');

    card.style.display = 'block';
}

/* ==========================================================
   INIT — called from loadUserData or DOMContentLoaded
   ========================================================== */
function initSprint1() {
    initQuickAdd();
    initMerchantAutocomplete();
    refreshMerchantSuggestions();
}

function refreshSprint1Dashboard() {
    updateSpendingVelocity();
    updateCategoryBudgetBars();
    updateMonthlyComparison();
    updateSpendingRadar();
    checkBudgetAlerts();
    updateGoalRings();
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSprint1);
} else {
    initSprint1();
}
