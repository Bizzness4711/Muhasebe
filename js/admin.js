// Admin paneli v2: sekmeli yapı (Kullanıcılar / İstatistikler / Aktivite / Sistem).
// Yetki: core.js loadUserData() içinde userDoc.data().role === 'admin' ile belirlenir, burada kaldırılmaz.
(function () {
  let allUsers = [];
  let adminLoaded = false;
  let countsLoaded = false;
  let adminSignupChart = null;
  let usersNextPageToken = null;
  let usersPage = 1;
  const USERS_PAGE_SIZE = 50;

  // Tarih formatı (kısa)
  function fmtDate(ts) {
    if (!ts) return '-';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return '-'; }
  }

  function tsMillis(ts) {
    try {
      if (!ts) return 0;
      return ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
    } catch { return 0; }
  }

  // Sekmeler arası geçiş (state kaybolmaz, sadece gizle/göster)
  function initTabs() {
    const tabs = document.querySelectorAll('.admin-tab');
    const panels = document.querySelectorAll('.admin-tab-panel');
    if (!tabs.length) return;
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.adminTab;
        const panel = document.querySelector(`.admin-tab-panel[data-admin-panel="${target}"]`);
        if (panel) panel.classList.add('active');
        // Sekmeye özel taze render
        if (target === 'stats') { loadStats(); }
        if (target === 'activity') { loadActivity(); }
        if (target === 'system') { loadSystem(); }
      });
    });
  }

  // Ana giriş: core.js auth akışından çağrılır, imza korunur.
  window.loadAdminData = async function () {
    if (typeof isAdmin !== 'undefined' && !isAdmin) return;
    if (typeof db === 'undefined' || typeof currentUser === 'undefined' || !currentUser) return;
    const body = document.getElementById('adminUsersBody');
    if (!body) return;
    try {
      body.innerHTML = '<tr><td colspan="7" class="empty-state">Yükleniyor...</td></tr>';
      const query = db.collection('users').orderBy('createdAt', 'desc').limit(USERS_PAGE_SIZE);
      const snap = usersNextPageToken
        ? await query.startAfter(usersNextPageToken).get()
        : await query.get();
      allUsers = [];
      snap.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
      usersNextPageToken = snap.docs.length === USERS_PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null;
      adminLoaded = true;
      countsLoaded = false;
      await loadCounts();
      renderAdminUsers();
      updateUserPaginationUI();
      loadStats();
      loadActivity();
      loadSystem();
    } catch (e) {
      console.error('Admin yükleme hatası:', e);
      body.innerHTML = `<tr><td colspan="7" class="empty-state">Yüklenemedi: ${e.code === 'permission-denied' ? 'Firestore kurallarında admin izni yok. firestore.rules dosyasına bakın.' : escapeHtml(e.message)}</td></tr>`;
    }
  };

  // Hesap/işlem/transfer sayılarını paralel çek, cache'le.
  // Yönetim paneli yalnızca son 50 kullanıcıyı yükler; sınırsız kullanıcı taraması ve gereksiz Firestore okumaları önlenir.
  async function loadCounts() {
    if (countsLoaded || !allUsers.length) return;
    try {
      await Promise.all(allUsers.map(async (u) => {
        try {
          const [accSnap, txSnap, trSnap] = await Promise.all([
            db.collection('users').doc(u.id).collection('accounts').get(),
            db.collection('users').doc(u.id).collection('transactions').get(),
            db.collection('users').doc(u.id).collection('transfers').get()
          ]);
          u._accountCount = accSnap.size;
          u._txCount = txSnap.size;
          u._transferCount = trSnap.size;
        } catch (err) {
          console.warn('Sayaç alınamadı:', u.id, err);
          u._accountCount = u._accountCount ?? '-';
          u._txCount = u._txCount ?? '-';
          u._transferCount = u._transferCount ?? '-';
        }
      }));
      countsLoaded = true;
    } catch (e) {
      console.warn('Sayaçlar yüklenemedi.', e);
    }
  }

  function updateUserPaginationUI() {
    const prev = document.getElementById('adminUsersPrev');
    const next = document.getElementById('adminUsersNext');
    const page = document.getElementById('adminUsersPage');
    if (prev) prev.disabled = usersPage <= 1;
    if (next) next.disabled = !usersNextPageToken;
    if (page) page.textContent = 'Sayfa ' + usersPage;
  }

  async function loadNextUserPage() {
    if (!usersNextPageToken) return;
    usersPage += 1;
    await window.loadAdminData();
  }

  async function loadPreviousUserPage() {
    // Firestore cursor pagination is forward-only with this lightweight client UI.
    // Reaching previous pages requires retaining cursors; keep a small cursor stack.
    if (usersPage <= 1) return;
    usersPage -= 1;
    usersNextPageToken = null;
    await window.loadAdminData();
  }

  // "Yenile" sayacı sıfırlar (tekrar çeker)
  async function refreshAll() {
    countsLoaded = false;
    usersNextPageToken = null;
    usersPage = 1;
    if (adminSignupChart) { try { adminSignupChart.destroy(); } catch {} adminSignupChart = null; }
    await window.loadAdminData();
  }

  function filteredUsers() {
    const q = (document.getElementById('adminSearch')?.value || '').toLowerCase().trim();
    const roleFilter = document.getElementById('adminRoleFilter')?.value || 'all';
    return allUsers.filter(u => {
      const role = u.role === 'admin' ? 'admin' : 'user';
      if (roleFilter !== 'all' && role !== roleFilter) return false;
      if (!q) return true;
      return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    });
  }

  function renderAdminUsers() {
    const body = document.getElementById('adminUsersBody');
    if (!body) return;
    const list = filteredUsers();
    const count = document.getElementById('adminCount');
    if (count) count.textContent = `${list.length}/${allUsers.length} kullanıcı`;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty-state">Kullanıcı bulunamadı.</td></tr>';
      return;
    }
    body.innerHTML = list.map(u => {
      const role = u.role === 'admin' ? 'admin' : 'user';
      const isSelf = typeof currentUser !== 'undefined' && currentUser && u.id === currentUser.uid;
      return `<tr>
        <td>${escapeHtml(u.name || '-')}</td>
        <td>${escapeHtml(u.email || '-')}</td>
        <td><span class="admin-role ${role}">${role}</span></td>
        <td>${u._accountCount ?? '-'}</td>
        <td>${u._txCount ?? '-'}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td><div class="admin-row-actions">
          <button class="admin-mini-btn" onclick="openAdminDetail('${u.id}')">Detay</button>
          <button class="admin-mini-btn" onclick="toggleAdminRole('${u.id}', '${role}')">${role === 'admin' ? 'User yap' : 'Admin yap'}</button>
          ${isSelf ? '' : `<button class="admin-mini-btn danger" onclick="deleteAdminUser('${u.id}')">Kaydı sil</button>`}
        </div></td>
      </tr>`;
    }).join('');
  }

  // Kullanıcı detay modalı (hesap listesiyle birlikte)
  window.openAdminDetail = async function (uid) {
    const modal = document.getElementById('adminDetailModal');
    const body = document.getElementById('adminDetailBody');
    if (!modal || !body) return;
    const u = allUsers.find(x => x.id === uid);
    if (!u) return;
    body.innerHTML = '<p class="empty-state">Yükleniyor...</p>';
    modal.style.display = 'flex';
    try {
      // Hesapların tek tek listesi (8 nereden geliyor sorusunun cevabı burada)
      let totalTry = 0;
      let accCount = u._accountCount ?? '-';
      let txCount = u._txCount ?? '-';
      let accRows = '';
      try {
        const accSnap = await db.collection('users').doc(uid).collection('accounts').orderBy('name').get();
        accCount = accSnap.size;
        u._accountCount = accSnap.size;
        const items = [];
        accSnap.forEach(doc => {
          const a = doc.data();
          items.push({ id: doc.id, ...a });
          if ((a.currency || 'TRY') === 'TRY') totalTry += Number(a.balance || 0);
        });
        accRows = items.length ? items.map(a => {
          let created = '-';
          try { created = a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString('tr-TR') : '-'; } catch {}
          return `<tr><td>${escapeHtml(a.name || '-')}</td><td>${escapeHtml(a.currency || '-')}</td><td>₺${Number(a.balance || 0).toFixed(2)}</td><td>${escapeHtml(created)}</td><td><small>${escapeHtml(a.id.slice(0, 6))}…</small> <button class="admin-mini-btn danger" onclick="deleteAdminAccount('${uid}', '${a.id}')">Sil</button></td></tr>`;
        }).join('') : '<tr><td colspan="5" class="empty-state">Bu kullanıcıda hesap yok.</td></tr>';
      } catch (e) { console.warn('Detay hesap okunamadı.', e); accRows = '<tr><td colspan="5" class="empty-state">Hesaplar okunamadı (yetki hatası olabilir).</td></tr>'; }
      const lastLogin = u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'Bilinmiyor';
      body.innerHTML = `
        <p><strong>İsim:</strong> ${escapeHtml(u.name || '-')}</p>
        <p><strong>E-posta:</strong> ${escapeHtml(u.email || '-')}</p>
        <p><strong>UID:</strong> <small>${escapeHtml(u.id)}</small></p>
        <p><strong>Rol:</strong> <span class="admin-role ${u.role === 'admin' ? 'admin' : 'user'}">${escapeHtml(u.role || 'user')}</span></p>
        <p><strong>Kayıt:</strong> ${fmtDate(u.createdAt)}</p>
        <p><strong>Son giriş:</strong> ${escapeHtml(lastLogin)}</p>
        <p><strong>Hesap sayısı:</strong> ${accCount}</p>
        <p><strong>İşlem sayısı:</strong> ${txCount}</p>
        <p><strong>Toplam TRY bakiye:</strong> ₺${Number(totalTry).toFixed(2)}</p>
        <h3 style="margin:14px 0 8px;font-size:.95rem;">Hesaplar (${accCount})</h3>
        <div class="table-scroll"><table class="advanced-report-table"><thead><tr><th>Ad</th><th>Para birimi</th><th>Bakiye</th><th>Oluşturma</th><th>ID</th></tr></thead><tbody>${accRows}</tbody></table></div>
        <h3 style="margin:14px 0 8px;font-size:.95rem;">Bildirimler (son 20, silinenler dahil)</h3>
        <div id="adminDetailNotifs"><p class="empty-state">Yükleniyor...</p></div>`;
      renderAdminUsers();
      try {
        const notifSnap = await db.collection('users').doc(uid).collection('notifications').orderBy('ts', 'desc').limit(20).get();
        const box = document.getElementById('adminDetailNotifs');
        if (box) {
          if (notifSnap.empty) box.innerHTML = '<p class="empty-state">Bildirim yok.</p>';
          else {
            const rows = [];
            notifSnap.forEach(doc => {
              const n = doc.data() || {};
              const when = Number(n.ts) ? new Date(n.ts).toLocaleString('tr-TR') : '-';
              const state = n.deleted ? 'silindi' : (n.read ? 'okundu' : 'yeni');
              rows.push(`<tr><td>${escapeHtml(n.title || 'Finora')}</td><td>${escapeHtml(n.message || '')}</td><td>${state}</td><td>${escapeHtml(when)}</td></tr>`);
            });
            box.innerHTML = `<div class="table-scroll"><table class="advanced-report-table"><thead><tr><th>Başlık</th><th>Mesaj</th><th>Durum</th><th>Tarih</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
          }
        }
      } catch (e) { console.warn('Admin bildirim okunamadı.', e); }
    } catch (e) {
      body.innerHTML = `<p class="empty-state">Detay yüklenemedi: ${escapeHtml(e.message)}</p>`;
    }
  };

  function closeAdminDetail() {
    const modal = document.getElementById('adminDetailModal');
    if (modal) modal.style.display = 'none';
  }

  // İstatistikler sekmesi
  function loadStats() {
    const el = document.getElementById('adminStats');
    if (!el || !allUsers.length) return;
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    const monthAgo = now - 30 * 86400000;
    const total = allUsers.length;
    const admins = allUsers.filter(u => u.role === 'admin').length;
    const last7 = allUsers.filter(u => tsMillis(u.createdAt) > weekAgo).length;
    const last30 = allUsers.filter(u => tsMillis(u.createdAt) > monthAgo).length;
    const num = v => (typeof v === 'number' ? v : 0);
    const totalAcc = allUsers.reduce((s, u) => s + num(u._accountCount), 0);
    const totalTx = allUsers.reduce((s, u) => s + num(u._txCount), 0);
    const totalTr = allUsers.reduce((s, u) => s + num(u._transferCount), 0);
    // Aktif tekrarlayan işlem: collectionGroup kuralı gerekli, burada çekmiyoruz.
    // collectionGroup için kural gerekli: users altındaki recurringTransactions için admin read kuralı olmadan client okuyamaz.
    const stats = [
      { label: 'Toplam kullanıcı', value: total },
      { label: 'Admin sayısı', value: admins },
      { label: 'Son 7 gün', value: last7 },
      { label: 'Son 30 gün', value: last30 },
      { label: 'Toplam hesap', value: totalAcc },
      { label: 'Toplam işlem', value: totalTx },
      { label: 'Toplam transfer', value: totalTr },
      { label: 'Aktif tekrarlayan', value: 'kural gerekli' },
      { label: 'Ort. hesap/kullanıcı', value: total ? (totalAcc / total).toFixed(1) : '0' },
      { label: 'Ort. işlem/kullanıcı', value: total ? (totalTx / total).toFixed(1) : '0' },
    ];
    el.innerHTML = stats.map(s => `<div class="advanced-stat-card"><span>${s.label}</span><strong>${s.value}</strong></div>`).join('');
    const breakdown = document.getElementById('adminBreakdownBody');
    if (breakdown) {
      breakdown.innerHTML = allUsers.map(u => `<tr><td>${escapeHtml(u.name || u.email || u.id.slice(0, 6))}</td><td>${u._accountCount ?? '-'}</td><td>${u._txCount ?? '-'}</td><td>${u._transferCount ?? '-'}</td></tr>`).join('');
    }
    renderSignupChart();
  }

  // Son 12 haftanın haftalık yeni kullanıcı bar grafiği
  function renderSignupChart() {
    const canvas = document.getElementById('adminSignupChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const weeks = [];
    const labels = [];
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const mondayOffset = (now.getDay() + 6) % 7;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - mondayOffset);
    for (let i = 11; i >= 0; i--) {
      const start = new Date(thisMonday);
      start.setDate(thisMonday.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      weeks.push({ start: start.getTime(), end: end.getTime() + 86399999 });
      labels.push(start.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }));
    }
    const data = weeks.map(w => allUsers.filter(u => {
      const t = tsMillis(u.createdAt);
      return t >= w.start && t <= w.end;
    }).length);
    if (adminSignupChart) { try { adminSignupChart.destroy(); } catch {} }
    adminSignupChart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Yeni kullanıcı', data }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  // Aktivite sekmesi: son 50 kayıt timeline
  function loadActivity() {
    const list = document.getElementById('adminActivityList');
    if (!list) return;
    const sorted = [...allUsers].sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt)).slice(0, 50);
    if (!sorted.length) {
      list.innerHTML = '<p class="empty-state">Henüz aktivite yok.</p>';
      return;
    }
    list.innerHTML = sorted.map(u => {
      const t = tsMillis(u.createdAt);
      const days = t ? Math.floor((Date.now() - t) / 86400000) : null;
      const ago = days === null ? 'tarih bilinmiyor' : days === 0 ? 'bugün kayıt oldu' : days === 1 ? '1 gün önce kayıt oldu' : `${days} gün önce kayıt oldu`;
      const initial = (u.name || u.email || '?').charAt(0).toUpperCase();
      const role = u.role === 'admin' ? 'admin' : 'user';
      return `<div class="admin-activity-item">
        <span class="admin-activity-avatar">${escapeHtml(initial)}</span>
        <span class="admin-activity-info"><strong>${escapeHtml(u.name || '-')}</strong><small>${escapeHtml(u.email || '-')} · ${escapeHtml(ago)}</small></span>
        <span class="admin-role ${role}">${role}</span>
      </div>`;
    }).join('');
  }

  // Sistem sekmesi
  function loadSystem() {
    const sysEl = document.getElementById('adminSysInfo');
    if (sysEl) {
      let projectId = '-';
      try { projectId = firebase.app().options.projectId || '-'; } catch {}
      const email = (typeof currentUser !== 'undefined' && currentUser?.email) || '-';
      const uid = (typeof currentUser !== 'undefined' && currentUser?.uid) || '-';
      const theme = document.documentElement.dataset.theme || document.body.getAttribute('data-theme') || '-';
      const version = typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'v2026.09';
      sysEl.innerHTML = `
        <p><strong>Proje:</strong> ${escapeHtml(projectId)}</p>
        <p><strong>Admin:</strong> ${escapeHtml(email)} <small>(${escapeHtml(uid)})</small></p>
        <p><strong>Tema:</strong> ${escapeHtml(theme)}</p>
        <p><strong>Sürüm:</strong> ${escapeHtml(version)}</p>`;
    }
    const ratesEl = document.getElementById('adminRatesBox');
    if (ratesEl) {
      const lastUpdate = document.getElementById('lastRateUpdate')?.textContent || '-';
      const r = (typeof exchangeRates !== 'undefined') ? exchangeRates : {};
      const f = v => (Number(v) > 0 ? `₺${Number(v).toFixed(2)}` : '-');
      const status = (typeof ratesStatus !== 'undefined') ? ratesStatus : 'unknown';
      ratesEl.innerHTML = `
        <p><strong>Durum:</strong> ${escapeHtml(status)} · <strong>Son güncelleme:</strong> ${escapeHtml(lastUpdate)}</p>
        <p>USD: ${f(r.USD)} · EUR: ${f(r.EUR)} · Gram: ${f(r.GRAM_ALTIN)} · Çeyrek: ${f(r.CEYREK_ALTIN)}</p>`;
    }
    const browserEl = document.getElementById('adminBrowserInfo');
    if (browserEl) {
      browserEl.innerHTML = `
        <p><strong>UA:</strong> ${escapeHtml(navigator.userAgent)}</p>
        <p><strong>Ekran:</strong> ${window.screen.width}x${window.screen.height} · <strong>Dil:</strong> ${escapeHtml(navigator.language)}</p>`;
    }
  }

  window.toggleAdminRole = async function (uid, currentRole) {
    if (!confirm(`Bu kullanıcının rolünü ${currentRole === 'admin' ? 'user' : 'admin'} olarak değiştireyim mi?`)) return;
    try {
      await db.collection('users').doc(uid).update({ role: currentRole === 'admin' ? 'user' : 'admin' });
      showToast('Rol güncellendi.', 'success');
      countsLoaded = false;
      await window.loadAdminData();
    } catch (e) { showToast('Rol güncellenemedi: ' + e.message, 'error'); }
  };

  // Admin: kullanıcının tek bir hesabını sil (fazla/çift kayıt temizliği için)
  window.deleteAdminAccount = async function (uid, accId) {
    if (!confirm('Bu hesabı sileyim mi? Buna bağlı işlemler silinmez, sadece hesap kaydı gider.')) return;
    try {
      await db.collection('users').doc(uid).collection('accounts').doc(accId).delete();
      showToast('Hesap silindi.', 'success');
      countsLoaded = false;
      await window.loadAdminData();
      await window.openAdminDetail(uid);
    } catch (e) { showToast('Hesap silinemedi: ' + e.message, 'error'); }
  };

  window.deleteAdminUser = async function (uid) {    if (!confirm('Bu kullanıcının Firestore kaydını sileyim mi? (Auth kaydı silinmez, kullanıcı tekrar giriş yapabilir. Tam silme için Firebase Console > Authentication kullanın.)')) return;
    try {
      await db.collection('users').doc(uid).delete();
      showToast('Kullanıcı kaydı silindi.', 'success');
      await window.loadAdminData();
    } catch (e) { showToast('Silinemedi: ' + e.message, 'error'); }
  };

  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    document.getElementById('refreshAdminBtn')?.addEventListener('click', refreshAll);
    document.getElementById('adminSearch')?.addEventListener('input', renderAdminUsers);
    document.getElementById('adminRoleFilter')?.addEventListener('change', renderAdminUsers);
    document.getElementById('adminUsersNext')?.addEventListener('click', loadNextUserPage);
    document.getElementById('adminUsersPrev')?.addEventListener('click', loadPreviousUserPage);
    document.getElementById('adminLink')?.addEventListener('click', () => {
      if (!adminLoaded) window.loadAdminData();
    });
    document.getElementById('closeAdminDetail')?.addEventListener('click', closeAdminDetail);
    document.getElementById('adminDetailModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'adminDetailModal') closeAdminDetail();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAdminDetail();
    });
    document.getElementById('adminRefreshRatesBtn')?.addEventListener('click', async () => {
      try {
        if (typeof fetchExchangeRates === 'function') {
          await fetchExchangeRates();
          showToast('Kurlar güncellendi.', 'success');
          loadSystem();
        }
      } catch (e) { showToast('Kur güncellenemedi: ' + e.message, 'error'); }
    });
    document.getElementById('adminClearCacheBtn')?.addEventListener('click', () => {
      if (!confirm('Önbellek temizlensin mi? (Tema ve PIN korunur.)')) return;
      try {
        Object.keys(localStorage).forEach(k => {
          if (k === 'theme-v2' || k.startsWith('security-')) return;
          localStorage.removeItem(k);
        });
        showToast('Önbellek temizlendi.', 'success');
      } catch (e) { showToast('Temizlenemedi: ' + e.message, 'error'); }
    });
    document.getElementById('adminReloadBtn')?.addEventListener('click', () => {
      if (!confirm('Cache yenilenip sayfa yeniden başlatılsın mı?')) return;
      try {
        Object.keys(localStorage).forEach(k => {
          if (k === 'theme-v2' || k.startsWith('security-')) return;
          localStorage.removeItem(k);
        });
      } finally { location.reload(); }
    });
  });
})();

// Firestore Console > Rules için önerilenler:
// - users/{uid}: read/update kendi, admin read/update tüm
// - users/{uid}/accounts|transactions|transfers|recurringTransactions|goals: kendi read/write
// - collectionGroup 'accounts' için admin read (opsiyonel)
