// Yazdırılabilir aylık özet: #printReport doldurulur, window.print() çağrılır.
// core.js verilerini (transactions, accounts, currentMonth) kullanır, PDF hedefe yazdırılır.
(function () {
  function tl(n) {
    return `₺${Number(n || 0).toFixed(2)}`;
  }

  function buildPrintReport() {
    const month = currentMonth;
    const txs = transactions.filter(t => String(t.date || '').startsWith(month));
    const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
    const byCat = {};
    txs.filter(t => t.type === 'expense').forEach(t => {
      const c = t.category || 'Diğer';
      byCat[c] = (byCat[c] || 0) + Number(t.amount || 0);
    });
    const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `<tr><td>${escapeHtml(c)}</td><td class="num">${tl(v)}</td></tr>`).join('') ||
      '<tr><td colspan="2">Masraf yok.</td></tr>';
    const accRows = accounts.map(a =>
      `<tr><td>${escapeHtml(a.name || '-')}</td><td>${escapeHtml(a.currency || 'TRY')}</td><td class="num">${tl(a.balance)}</td></tr>`
    ).join('') || '<tr><td colspan="3">Hesap yok.</td></tr>';

    document.getElementById('printReport').innerHTML = `
      <h1>Finora — Aylık Özet</h1>
      <p class="pr-sub">${escapeHtml(formatMonth(month))} · Oluşturma: ${new Date().toLocaleString('tr-TR')}</p>
      <table class="pr-table"><tbody>
        <tr><th>Toplam Gelir</th><td class="num">${tl(income)}</td></tr>
        <tr><th>Toplam Masraf</th><td class="num">${tl(expense)}</td></tr>
        <tr><th>Net</th><td class="num">${tl(income - expense)}</td></tr>
        <tr><th>İşlem Adedi</th><td class="num">${txs.length}</td></tr>
      </tbody></table>
      <h2>Kategori Bazında Masraf</h2>
      <table class="pr-table"><thead><tr><th>Kategori</th><th>Tutar</th></tr></thead><tbody>${catRows}</tbody></table>
      <h2>Hesap Bakiyeleri</h2>
      <table class="pr-table"><thead><tr><th>Hesap</th><th>Para Birimi</th><th>Bakiye</th></tr></thead><tbody>${accRows}</tbody></table>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('printReportBtn')?.addEventListener('click', () => {
      if (!currentUser) { showToast('Önce giriş yapın.', 'error'); return; }
      buildPrintReport();
      setTimeout(() => window.print(), 50);
    });
  });
})();
