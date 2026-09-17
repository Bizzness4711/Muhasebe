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
        if (newCurrent >= goal.target && typeof sendGoalReachedEmail === 'function') sendGoalReachedEmail(goal.name, goal.target);
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

