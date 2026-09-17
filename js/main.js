// ponytail: not split — single DOMContentLoaded closure with shared state
// (selectedType, editingTransactionId). 889 lines, manageable.
document.addEventListener('DOMContentLoaded', () => {
        // Gizlilik butonu
    document.getElementById('privacyModeBtn').addEventListener('click', togglePrivacyMode);

    // Göz butonu
    document.getElementById('toggleBalanceBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        toggleBalanceVisibility();
    });

    // Bakiye kartı (özet modal)sonu
    document.getElementById('balanceCard').addEventListener('click', showAccountSummary);
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

    const newTxBtn = document.getElementById('newTransactionBtn');
    if (newTxBtn) newTxBtn.addEventListener('click', () => {
        editingTransactionId = null;
        document.getElementById('transactionForm').reset();
        document.getElementById('date').value = formatLocalDate(new Date());
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
    const menuBtn = document.getElementById('menuBtn');
    const menuIcon = menuBtn.querySelector('i');

    function updateMenuIcon() {
        const isClosed = window.innerWidth > 700
            ? document.body.classList.contains('sidebar-closed')
            : !document.getElementById('sidebar').classList.contains('open');
        menuIcon.classList.toggle('fa-bars', isClosed);
        menuIcon.classList.toggle('fa-xmark', !isClosed);
    }

    menuBtn.addEventListener('click', () => {
        if (window.innerWidth <= 700) {
            document.getElementById('sidebar').classList.toggle('open');
            document.getElementById('sidebarOverlay').classList.toggle('show');
        } else {
            document.body.classList.toggle('sidebar-closed');
        }
        updateMenuIcon();
    });
    document.getElementById('sidebarOverlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('show');
        updateMenuIcon();
    });

    // Bildirimler: zil paneli + izin + ses ayarı
    // (Ses için ilk kullanıcı etkileşiminde AudioContext açılır.)
    document.addEventListener('click', function unlockAudioOnce() {
        if (typeof unlockNotifAudio === 'function') unlockNotifAudio();
        document.removeEventListener('click', unlockAudioOnce);
    });
    const notificationBtn = document.getElementById('notificationBtn');
    const notificationPanel = document.getElementById('notificationPanel');
    if (notificationBtn && notificationPanel) {
        notificationBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notificationPanel.hidden = !notificationPanel.hidden;
        });
        document.addEventListener('click', (e) => {
            if (!notificationPanel.hidden && !e.target.closest('.notification-wrap')) notificationPanel.hidden = true;
        });
    }
    const markReadBtn = document.getElementById('clearNotificationsBtn');
    if (markReadBtn) markReadBtn.addEventListener('click', () => {
        notifications.forEach(n => n.read = true);
        saveNotifications();
        updateNotificationsUI();
    });
    document.getElementById('clearAllNotificationsBtn')?.addEventListener('click', () => window.clearAllNotifications());
    const enableBtn = document.getElementById('enableNotificationsBtn');
    if (enableBtn) enableBtn.addEventListener('click', requestNotificationPermission);
    const enableSettingBtn = document.getElementById('enableNotificationsSettingBtn');
    if (enableSettingBtn) enableSettingBtn.addEventListener('click', requestNotificationPermission);
    const soundToggle = document.getElementById('notifSoundToggle');
    if (soundToggle) {
        soundToggle.checked = isNotifSoundOn();
        soundToggle.addEventListener('change', () => {
            if (currentUser) localStorage.setItem(`notif-sound-${currentUser.uid}`, soundToggle.checked ? 'on' : 'off');
            showToast(soundToggle.checked ? 'Bildirim sesi açıldı.' : 'Bildirim sesi kapatıldı.', 'success');
        });
    }
    const testSoundBtn = document.getElementById('testNotifSoundBtn');
    if (testSoundBtn) testSoundBtn.addEventListener('click', () => {
        playNotificationSound();
        showToast('Test sesi çalındı.', 'success');
    });

    // Tema (tek kaynak: <html> üzerindeki data-theme — admin Sistem sekmesi doğru okur)
    document.getElementById('themeBtn').addEventListener('click', () => {
        const currentTheme = document.documentElement.dataset.theme || document.body.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = newTheme;
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
            await result.user.sendEmailVerification();
            if (typeof sendWelcomeEmail === 'function') sendWelcomeEmail(document.getElementById('registerName').value);
            showToast('Kayıt başarılı! E-posta doğrulama linki gönderildi.', 'success');
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

    // İşlem tipi (sadece ana form — Quick-Add kendi handler'ını kullanır)
    const mainForm = document.getElementById('transactionForm');
    if (mainForm) {
        mainForm.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                selectedType = e.target.closest('.type-btn').dataset.type;
                mainForm.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                e.target.closest('.type-btn').classList.add('active');
                updateCategorySelect();
                if (typeof updateSellFields === 'function') updateSellFields();
                if (typeof updateTransactionPurchaseFields === 'function') updateTransactionPurchaseFields();
            });
        });
    }

    document.getElementById('accountSelect').addEventListener('change', updateAccountRateInfo);

    // Kategori ekleme
    document.getElementById('categoryForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        const name = document.getElementById('newCategoryName').value.trim();
        const type = document.getElementById('newCategoryType').value === 'income' ? 'income' : 'expense';
        if (!name) { showToast('Kategori adı girin.', 'error'); return; }
        if (getCategories(type).some(c => c.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) {
            showToast('Bu kategori zaten var.', 'error');
            return;
        }
        try {
            const ref = await db.collection('users').doc(currentUser.uid).collection('categories').add({
                name, type, createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            customCategories.push({ id: ref.id, name, type });
            document.getElementById('categoryForm').reset();
            updateCategorySelect();
            showToast('Kategori eklendi.', 'success');
        } catch (error) { showToast('Eklenemedi: ' + error.message, 'error'); }
    });
    updateCategorySelect();

    // Kategori listesini aç/kapa
    document.getElementById('toggleCategoriesBtn')?.addEventListener('click', () => {
        const list = document.getElementById('categoriesList');
        const btn = document.getElementById('toggleCategoriesBtn');
        if (!list || !btn) return;
        list.hidden = !list.hidden;
        btn.setAttribute('aria-expanded', String(!list.hidden));
    });

    // Bütçe formu
    const budgetMonthInput = document.getElementById('budgetMonth');
    if (budgetMonthInput && !budgetMonthInput.value) budgetMonthInput.value = currentMonth;
    document.getElementById('budgetForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        const category = document.getElementById('budgetCategory').value;
        const limit = parseFloat(document.getElementById('budgetLimit').value);
        const month = document.getElementById('budgetMonth').value || currentMonth;
        if (!category || !(limit > 0)) { showToast('Kategori ve limit girin.', 'error'); return; }
        try {
            await db.collection('users').doc(currentUser.uid).collection('budgets').add({
                category, limit, month,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            document.getElementById('budgetForm').reset();
            if (budgetMonthInput) budgetMonthInput.value = currentMonth;
            showToast('Bütçe kaydedildi!', 'success');
            await loadBudgets();
            updateBudgetsUI();
        } catch (error) { showToast('Bütçe kaydedilemedi: ' + error.message, 'error'); }
    });

    // İşlem formu
    document.getElementById('transactionForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        const accountId = document.getElementById('accountSelect').value;
        const amount = parseFloat(document.getElementById('amount').value);
        const account = accounts.find(a => a.id === accountId);
        if (!accountId || !Number.isFinite(amount) || amount <= 0 || !account) { showToast('Lütfen geçerli bir hesap ve tutar seçin!', 'error'); return; }
        const isCreditType = account.type === 'credit' || (account.name || '').toLowerCase().includes('kredi');
        if (selectedType === 'expense' && !isCreditType && Number(account.balance || 0) < amount) {
            showToast(`Yetersiz bakiye! ${account.name} hesabında ₺${Number(account.balance || 0).toFixed(2)} var, ₺${amount.toFixed(2)} harcamaya çalışıyorsunuz.`, 'error');
            return;
        }
        const isInvestment = isInvestmentAccount(account);
        const isSell = selectedType === 'sell';
        const purchaseRate = isInvestment && !isSell
            ? parseFloat(document.getElementById('transactionPurchaseRate').value)
            : 0;
        const sellRate = isInvestment && isSell
            ? parseFloat(document.getElementById('transactionSellRate').value)
            : 0;
        const sellTargetId = isSell ? document.getElementById('transactionSellTarget')?.value : '';
        if (isInvestment && !isSell && !(purchaseRate > 0)) {
            showToast('Döviz/altın işlemi için alış fiyatını girin.', 'error');
            return;
        }
        if (isSell) {
            if (!(sellRate > 0)) { showToast('Satış kuru girin.', 'error'); return; }
            if (!sellTargetId) { showToast('TRY gelirinin ekleneceği hesabı seçin.', 'error'); return; }
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
                    transactionRate: isSell ? sellRate : transactionRate,
                    transactionRateDate: new Date().toISOString(),
                    profitLoss: isSell ? 0 : profitLoss,
                    sellRate: isSell ? sellRate : undefined,
                    sellTargetAccountId: isSell ? sellTargetId : undefined,
                    sellTargetAccountName: isSell ? (accounts.find(a => a.id === sellTargetId)?.name || '') : undefined,
                    isInstallment,
                    installmentCount,
                    installmentInterestRate,
                    installmentInterestAmount,
                    installmentTotal,
                    installmentAmount,
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
                if (isSell) {
                    const oldSellTargetId = oldTransaction.sellTargetAccountId || '';
                    const oldSellTarget = oldSellTargetId ? accounts.find(a => a.id === oldSellTargetId) : null;
                    const newSellTargetId = sellTargetId;
                    const newSellTarget = accounts.find(a => a.id === newSellTargetId);
                    if (oldSellTarget) {
                        const revertAmount = Number(oldTransaction.amount || 0);
                        const revertRate = Number(oldTransaction.sellRate || oldTransaction.transactionRate || 0);
                        const revertProceeds = revertAmount * revertRate;
                        batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(oldSellTargetId), {
                            balance: Number(oldSellTarget.balance || 0) - revertProceeds
                        });
                    }
                    if (oldAccount) {
                        const revertInvestBalance = Number(oldAccount.balance || 0) + Number(oldTransaction.amount || 0);
                        batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(oldAccount.id), {
                            balance: revertInvestBalance,
                            quantity: revertInvestBalance
                        });
                    }
                    if (newSellTarget) {
                        const newProceeds = amount * sellRate;
                        batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(newSellTargetId), {
                            balance: Number(newSellTarget.balance || 0) + newProceeds
                        });
                    }
                    const investNewBalance = Number(account.balance || 0) - amount;
                    batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(account.id), {
                        balance: investNewBalance,
                        quantity: investNewBalance
                    });
                } else if (oldAccount && oldAccount.id === account.id) {
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
                document.getElementById('date').value = formatLocalDate(new Date());
                document.getElementById('recurringOptions').hidden = true;
                document.getElementById('installmentOptions').hidden = true;
                document.getElementById('creditInstallmentDetails').hidden = true;
                document.getElementById('transactionSubmitBtn').innerHTML = '<i class="fas fa-save"></i> Kaydet';
                showToast('İşlem güncellendi!', 'success');
                if (typeof saveMerchantToHistory === 'function') saveMerchantToHistory(document.getElementById('description').value);
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
                transactionRate: isSell ? sellRate : transactionRate,
                transactionRateDate: new Date().toISOString(),
                profitLoss: isSell ? 0 : profitLoss,
                sellRate: isSell ? sellRate : undefined,
                sellTargetAccountId: isSell ? sellTargetId : undefined,
                sellTargetAccountName: isSell ? (accounts.find(a => a.id === sellTargetId)?.name || '') : undefined,
                isInstallment,
                installmentCount,
                installmentInterestRate,
                installmentInterestAmount,
                installmentTotal,
                installmentAmount,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isRecurringSource: isRecurring
            });
            if (account) {
                if (isSell && account && sellTargetId) {
                    const sellAccount = accounts.find(a => a.id === sellTargetId);
                    if (!sellAccount) { showToast('Hedef hesap bulunamadı.', 'error'); return; }
                    const investNewBalance = account.balance - amount;
                    const costBasis = amount * (account.openingRate || account.buyPrice || purchaseRate);
                    const proceeds = amount * sellRate;
                    const realizedPL = proceeds - costBasis;
                    const tryNewBalance = Number(sellAccount.balance || 0) + proceeds;
                    const batch = db.batch();
                    batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(accountId), {
                        balance: investNewBalance,
                        quantity: investNewBalance
                    });
                    batch.update(db.collection('users').doc(currentUser.uid).collection('accounts').doc(sellTargetId), {
                        balance: tryNewBalance
                    });
                    const txRef = db.collection('users').doc(currentUser.uid).collection('transactions').doc(transactionRef.id);
                    batch.update(txRef, { profitLoss: realizedPL });
                    await batch.commit();
                    const plLabel = realizedPL >= 0 ? `+₺${realizedPL.toFixed(2)} kâr` : `₺${realizedPL.toFixed(2)} zarar`;
                    showToast(`Satış kaydedildi! ${plLabel}`, 'success');
                } else {
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
            document.getElementById('date').value = formatLocalDate(new Date());
            document.getElementById('recurringOptions').hidden = true;
            document.getElementById('installmentOptions').hidden = true;
            document.getElementById('creditInstallmentDetails').hidden = true;
            document.getElementById('creditCardDetails').hidden = true;
            updateTransactionPurchaseFields();
            showToast('İşlem kaydedildi!', 'success');
            if (typeof saveMerchantToHistory === 'function') saveMerchantToHistory(document.getElementById('description').value);
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
            document.getElementById('transferDate').value = formatLocalDate(new Date());
            showToast('Transfer başarılı!', 'success');
            await loadUserData();
        } catch (error) { showToast('Transfer hatası: ' + error.message, 'error'); }
    });

    // Filtreler
    document.getElementById('filterType').addEventListener('change', updateTransactionsUI);
    document.getElementById('filterAccount').addEventListener('change', updateTransactionsUI);

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
    document.getElementById('clearData').addEventListener('click', clearAllData);
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

    // Tarihleri ayarla
    document.getElementById('date').value = formatLocalDate(new Date());
    document.getElementById('transferDate').value = formatLocalDate(new Date());

    // Tema
    const savedTheme = localStorage.getItem('theme-v2') || 'light';
    document.documentElement.dataset.theme = savedTheme;
    document.querySelector('#themeBtn i').className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';

    // Kurları göster
    updateExchangeRatesDisplay();
    document.getElementById('currentMonthDisplay').textContent = formatMonth(currentMonth);
    });
