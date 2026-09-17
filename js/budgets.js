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
