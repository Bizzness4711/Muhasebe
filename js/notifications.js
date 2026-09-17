function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    const icon = document.createElement('i');
    icon.className = `fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`;
    const text = document.createElement('span');
    text.textContent = String(message);
    toast.append(icon, text);
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// Bildirimler: users/{uid}/notifications koleksiyonunda saklanır (en fazla 40).
// Her pazartesi 00:00'dan eski kayıtlar girişte otomatik silinir.
function notificationStorageKey() {
    return currentUser ? `notifications-${currentUser.uid}` : 'notifications';
}

function notifCollection() {
    return db.collection('users').doc(currentUser.uid).collection('notifications');
}

function mondayTs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
}

async function loadNotifications() {
    // Tek seferlik: eski localStorage bildirimlerini kalıcı sil.
    try { localStorage.removeItem(notificationStorageKey()); } catch (e) {}
    notifications = [];
    if (!currentUser) { updateNotificationsUI(); return; }
    try {
        const snap = await notifCollection().orderBy('ts', 'desc').limit(80).get();
        const cut = mondayTs();
        const olds = [];
        const actives = [];
        snap.forEach(doc => {
            const d = doc.data() || {};
            if (!Number(d.ts) || d.ts < cut) { olds.push(doc.ref); return; }
            if (d.deleted) return; // silinenler kullanıcıya gösterilmez, adminde durur
            actives.push({ id: doc.id, key: d.key || '', title: d.title || 'Finora', message: d.message || '', icon: d.icon || 'fa-bell', read: !!d.read, ts: d.ts });
        });
        notifications = actives.slice(0, 40);
        // 40 kaydı aşan aktifleri silinmiş işaretle (fiziksel silme pazartesi).
        for (const item of actives.slice(40)) {
            try { await notifCollection().doc(item.id).update({ deleted: true, deletedAt: Date.now() }); } catch (e) {}
        }
        for (const ref of olds) { try { await ref.delete(); } catch (e) {} }
    } catch (error) {
        console.warn('Bildirimler okunamadı.', error);
        notifications = [];
    }
    updateNotificationsUI();
}

function saveNotifications() {
    // Okundu bilgisini Firestore'a yazar (ateşle-unut).
    if (!currentUser) return;
    notifications.forEach(item => {
        if (!item.id || item._savedRead === item.read) return;
        item._savedRead = item.read;
        notifCollection().doc(item.id).update({ read: item.read }).catch(() => {});
    });
}

// Bildirim sesi: Web Audio ile kısa bip. Tarayıcılar ses için kullanıcı etkileşimi
// ister, ilk tıklamada context açılır (main.js içinde unlock edilir).
let notifAudioCtx = null;

function unlockNotifAudio() {
    try {
        if (!notifAudioCtx) notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (notifAudioCtx.state === 'suspended') notifAudioCtx.resume();
    } catch (e) { /* sessiz geç */ }
}

function isNotifSoundOn() {
    if (!currentUser) return true;
    return localStorage.getItem(`notif-sound-${currentUser.uid}`) !== 'off';
}

function playNotificationSound() {
    try {
        if (!isNotifSoundOn()) return;
        unlockNotifAudio();
        if (!notifAudioCtx) return;
        const now = notifAudioCtx.currentTime;
        const osc = notifAudioCtx.createOscillator();
        const gain = notifAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(notifAudioCtx.destination);
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.start(now);
        osc.stop(now + 0.5);
    } catch (e) {
        console.warn('Bildirim sesi çalınamadı.', e);
    }
}

function addNotification(id, message, icon = 'fa-bell', title = 'Finora') {
    if (notifications.some(item => item.key === id || item.id === id)) return;
    const item = { id: '', key: id, message, icon, title, read: false, ts: Date.now() };
    notifications.unshift(item);
    notifications = notifications.slice(0, 40);
    updateNotificationsUI();
    playNotificationSound();
    if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(title, { body: message, icon: 'icons/logo-192.png' }); } catch (e) { console.warn('Masaüstü bildirimi gösterilemedi.', e); }
    }
    if (!currentUser) return;
    notifCollection().add({ key: id, message, icon, title, read: false, ts: item.ts })
        .then(ref => { item.id = ref.id; })
        .catch(e => console.warn('Bildirim yazılamadı.', e));
}

function updateNotificationsUI() {
    const list = document.getElementById('notificationList');
    const count = document.getElementById('notificationCount');
    if (!list || !count) return;
    const unread = notifications.filter(item => !item.read);
    count.textContent = unread.length > 99 ? '99+' : String(unread.length);
    count.hidden = unread.length === 0;
    list.innerHTML = notifications.length
        ? notifications.slice(0, 12).map(item => `<div class="notification-item"><i class="fas ${escapeHtml(item.icon)}"></i><span><strong>${escapeHtml(item.title || 'Finora')}</strong> · ${escapeHtml(item.message)}</span><button class="delete-btn" onclick="event.stopPropagation();deleteNotification('${item.id}')" title="Bildirimi sil"><i class="fas fa-times"></i></button></div>`).join('')
        : '<div class="notification-empty">Yeni bildiriminiz yok.</div>';
}

window.deleteNotification = function (id) {
    const item = notifications.find(n => n.id === id || n.key === id);
    notifications = notifications.filter(n => n !== item);
    // Yumuşak silme: kayıt durur, admin görmeye devam eder.
    if (item && item.id && currentUser) notifCollection().doc(item.id).update({ deleted: true, deletedAt: Date.now() }).catch(() => {});
    updateNotificationsUI();
};

window.clearAllNotifications = async function () {
    if (!notifications.length || !confirm('Tüm bildirimler silinsin mi?')) return;
    const ids = notifications.filter(n => n.id).map(n => n.id);
    notifications = [];
    updateNotificationsUI();
    if (!currentUser) return;
    for (const did of ids) { try { await notifCollection().doc(did).update({ deleted: true, deletedAt: Date.now() }); } catch (e) {} }
};

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showToast('Bu tarayıcı masaüstü bildirimlerini desteklemiyor.', 'error');
        return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted' && typeof initPush === 'function') initPush();
    showToast(permission === 'granted' ? 'Masaüstü bildirimleri açıldı.' : 'Bildirim izni verilmedi.', permission === 'granted' ? 'success' : 'error');
}

// Otomatik kontroller: bugünkü tekrarlayan işlemler + hedef kilometre taşları + bütçe uyarıları.
// (Piyasa hareketi bildirimi bilinçli olarak yok: her açılışta gürültü yapıyordu.)
function checkNotifications() {
    if (!currentUser) return;
    const today = new Date().toISOString().split('T')[0];
    transactions.filter(item => item.recurringId && item.date === today).forEach(item => {
        addNotification(`recurring-${item.id}`, `Tekrarlayan işlem oluşturuldu: ${item.description}.`, 'fa-rotate');
    });

    goals.forEach(goal => {
        const progress = goal.amount > 0 ? (goal.current / goal.amount) * 100 : 0;
        const milestone = progress >= 100 ? 100 : progress >= 75 ? 75 : progress >= 50 ? 50 : progress >= 25 ? 25 : 0;
        if (milestone > 0) addNotification(`goal-${goal.id}-${milestone}`, `${goal.name} hedefiniz %${milestone} seviyesine ulaştı${milestone === 100 ? '!' : '.'}`, 'fa-bullseye');
    });

    budgets.filter(b => b.month === currentMonth).forEach(budget => {
        const spent = getBudgetSpent(budget.category, budget.month);
        const limit = Number(budget.limit) || 0;
        if (!(limit > 0)) return;
        const pct = (spent / limit) * 100;
        if (pct >= 100) addNotification(`budget-${budget.month}-${budget.category}-over`, `${budget.category} bütçesi aşıldı: ₺${spent.toFixed(2)} / ₺${limit.toFixed(2)}.`, 'fa-triangle-exclamation');
        else if (pct >= 80) addNotification(`budget-${budget.month}-${budget.category}-warn`, `${budget.category} bütçesinin %${pct.toFixed(0)} kullanıldı.`, 'fa-wallet');
    });
}

// Bütçeler
async function loadBudgets() {
    if (!currentUser) { budgets = []; return; }
    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('budgets').get();
        budgets = [];
        snap.forEach(doc => budgets.push({ id: doc.id, ...doc.data() }));
    } catch (error) {
        if (error.code === 'permission-denied') console.warn('Bütçeler için Firestore kuralı eksik.', error);
        else console.warn('Bütçeler yüklenemedi.', error);
        budgets = [];
    }
}

