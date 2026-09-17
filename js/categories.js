function getCategories(type) {
    const mine = customCategories.filter(c => c.type === type).map(c => c.name);
    return mine.length ? mine : (DEFAULT_CATEGORIES[type] || []);
}

function updateCategorySelect() {
    const select = document.getElementById('category');
    if (select) {
        const keep = select.value;
        select.innerHTML = '<option value="">Kategori Seçin</option>';
        getCategories(typeof selectedType !== 'undefined' ? selectedType : 'expense').forEach(category => {
            select.innerHTML += `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`;
        });
        if (getCategories(typeof selectedType !== 'undefined' ? selectedType : 'expense').includes(keep)) select.value = keep;
    }
    const budgetSelect = document.getElementById('budgetCategory');
    if (budgetSelect) {
        const keepB = budgetSelect.value;
        budgetSelect.innerHTML = '<option value="">Kategori Seçin</option>';
        getCategories('expense').forEach(category => {
            budgetSelect.innerHTML += `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`;
        });
        if (keepB) budgetSelect.value = keepB;
    }
    updateCategoryManagerUI();
}

function updateCategoryManagerUI() {
    const list = document.getElementById('categoriesList');
    if (!list) return;
    const items = customCategories.length ? customCategories : [
        ...DEFAULT_CATEGORIES.expense.map(name => ({ name, type: 'expense' })),
        ...DEFAULT_CATEGORIES.income.map(name => ({ name, type: 'income' }))
    ];
    list.innerHTML = items.map(c => {
        const del = c.id ? `<button class="delete-btn" onclick="deleteCategory('${c.id}')" title="Kategoriyi sil"><i class="fas fa-trash"></i></button>` : '';
        return `<div class="transaction-card-modern"><div class="transaction-info-modern">
            <div class="transaction-title-modern">${escapeHtml(c.name)}</div>
            <div class="transaction-subtitle-modern">${c.type === 'income' ? 'Gelir' : 'Masraf'}</div>
        </div>${del}</div>`;
    }).join('');
}

window.deleteCategory = async function (id) {
    if (!currentUser || !confirm('Bu kategori silinsin mi? Mevcut işlemler etkilenmez.')) return;
    try {
        await db.collection('users').doc(currentUser.uid).collection('categories').doc(id).delete();
        customCategories = customCategories.filter(c => c.id !== id);
        updateCategorySelect();
        showToast('Kategori silindi.', 'success');
    } catch (error) { showToast('Silinemedi: ' + error.message, 'error'); }
};
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

