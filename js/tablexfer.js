// Tablo aktarımı: filtreli işlem listesini CSV/XLSX indirir, CSV/XLSX yükler.
// core.js (transactions, transfers, accounts, db, currentUser) + SheetJS kullanır.
// Sütunlar: Tarih | Tip | Tutar | Kategori | Açıklama | Hesap | Hedef Hesap
(function () {
  const HEADERS = ['Tarih', 'Tip', 'Tutar', 'Kategori', 'Açıklama', 'Hesap', 'Hedef Hesap'];
  const TYPE_TR = { income: 'gelir', expense: 'masraf', transfer: 'transfer' };

  function status(msg) {
    const el = document.getElementById('tablexferStatus');
    if (el) el.textContent = msg || '';
  }

  // Ekrandaki filtrelerle aynı mantıkla satırları topla (transferler dahil).
  function getExportRows() {
    const filterType = document.getElementById('filterType')?.value || 'all';
    const filterAccount = document.getElementById('filterAccount')?.value || 'all';
    const rows = [];
    transactions.forEach(t => {
      if (filterType === 'income' && t.type !== 'income') return;
      if (filterType === 'expense' && t.type !== 'expense') return;
      if (filterType === 'transfer') return;
      if (filterAccount !== 'all' && t.accountId !== filterAccount) return;
      rows.push({
        Tarih: t.date || '',
        Tip: TYPE_TR[t.type] || t.type,
        Tutar: Number(t.amount || 0).toFixed(2).replace('.', ','),
        Kategori: t.category || '',
        'Açıklama': t.description || '',
        Hesap: t.accountName || '',
        'Hedef Hesap': ''
      });
    });
    transfers.forEach(t => {
      if (filterType === 'income' || filterType === 'expense') return;
      if (filterAccount !== 'all' && t.fromAccountId !== filterAccount && t.toAccountId !== filterAccount) return;
      rows.push({
        Tarih: t.date || '',
        Tip: 'transfer',
        Tutar: Number(t.amount || 0).toFixed(2).replace('.', ','),
        Kategori: 'Transfer',
        'Açıklama': t.description || '',
        Hesap: t.fromAccountName || '',
        'Hedef Hesap': t.toAccountName || ''
      });
    });
    rows.sort((a, b) => (b.Tarih || '').localeCompare(a.Tarih || ''));
    return rows;
  }

  function fileName(ext) {
    return `islemler-${new Date().toISOString().split('T')[0]}.${ext}`;
  }

  function downloadBlob(content, mime, name) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }

  function downloadCSV() {
    const rows = getExportRows();
    if (!rows.length) { showToast('İndirilecek işlem yok.', 'error'); return; }
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    // Türkçe Excel uyumu: ; ayraç + BOM.
    const csv = '﻿' + HEADERS.map(esc).join(';') + '\r\n' +
      rows.map(r => HEADERS.map(h => esc(r[h])).join(';')).join('\r\n');
    downloadBlob(csv, 'text/csv;charset=utf-8', fileName('csv'));
    showToast(`${rows.length} satır CSV indirildi.`, 'success');
  }

  function downloadXLSX() {
    if (typeof XLSX === 'undefined') { showToast('Excel kütüphanesi yüklenemedi.', 'error'); return; }
    const rows = getExportRows();
    if (!rows.length) { showToast('İndirilecek işlem yok.', 'error'); return; }
    const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'İşlemler');
    XLSX.writeFile(wb, fileName('xlsx'));
    showToast(`${rows.length} satır Excel indirildi.`, 'success');
  }

  function downloadTemplate() {
    const esc = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = '﻿' + HEADERS.map(esc).join(';') + '\r\n' +
      ['2026-09-16', 'masraf', '250,00', '🍔 Yemek', 'Örnek açıklama', 'Nakit', ''].map(esc).join(';') + '\r\n' +
      ['2026-09-16', 'transfer', '1000,00', 'Transfer', '', 'Ziraat Bankası', 'Nakit'].map(esc).join(';');
    downloadBlob(csv, 'text/csv;charset=utf-8', 'islem-sablonu.csv');
  }

  // --- İçe aktarma ---
  function normHeader(h) {
    return String(h || '').trim().toLocaleLowerCase('tr');
  }

  const COLMAP = {
    tarih: 'date', date: 'date',
    tip: 'type', type: 'type', tür: 'type',
    tutar: 'amount', amount: 'amount', miktar: 'amount',
    kategori: 'category', category: 'category',
    'açıklama': 'desc', aciklama: 'desc', description: 'desc',
    hesap: 'account', account: 'account', kaynak: 'account',
    'hedef hesap': 'to', 'hedef': 'to', to: 'to'
  };

  function parseAmount(raw) {
    let s = String(raw ?? '').trim().replace(/\s|₺|\$/g, '');
    if (!s) return NaN;
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else if (s.includes(',')) s = s.replace(',', '.'); // 250,00
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function parseDate(raw) {
    const s = String(raw ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{2})[.](\d{2})[.](\d{4})$/); // 16.09.2026
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return '';
  }

  function parseType(raw) {
    const s = String(raw || '').trim().toLocaleLowerCase('tr');
    if (['gelir', 'income', 'g', 'i'].includes(s)) return 'income';
    if (['masraf', 'gider', 'expense', 'm', 'e'].includes(s)) return 'expense';
    if (['transfer', 't'].includes(s)) return 'transfer';
    return '';
  }

  function findAccount(name) {
    const n = String(name || '').trim().toLocaleLowerCase('tr');
    return accounts.find(a => String(a.name || '').trim().toLocaleLowerCase('tr') === n);
  }

  function rowsFromCSV(text) {
    // Ayraç otomatik: ilk satırda ; varsa ;, yoksa , veya tab.
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lines.length) return [];
    const first = lines[0];
    const delim = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
    const split = line => {
      const out = [];
      let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q && c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = !q;
        else if (!q && c === delim) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map(s => s.trim());
    };
    const headers = split(lines[0]).map(normHeader);
    return lines.slice(1).map(split).map(cells => {
      const o = {};
      headers.forEach((h, i) => { const k = COLMAP[h]; if (k) o[k] = cells[i] ?? ''; });
      return o;
    });
  }

  function rowsFromXLSX(buf) {
    if (typeof XLSX === 'undefined') throw new Error('Excel kütüphanesi yüklenemedi.');
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!matrix.length) return [];
    const headers = matrix[0].map(normHeader);
    return matrix.slice(1).map(cells => {
      const o = {};
      headers.forEach((h, i) => { const k = COLMAP[h]; if (k) o[k] = cells[i] ?? ''; });
      return o;
    });
  }

  async function importTableFile(file) {
    if (!file || !currentUser) return;
    status('Dosya okunuyor...');
    try {
      const ext = file.name.split('.').pop().toLocaleLowerCase('tr');
      let rawRows;
      if (ext === 'csv') rawRows = rowsFromCSV(await file.text());
      else if (ext === 'xlsx' || ext === 'xls') rawRows = rowsFromXLSX(await file.arrayBuffer());
      else { showToast('Sadece CSV veya Excel dosyası yükleyin.', 'error'); status(''); return; }
      if (!rawRows.length) { showToast('Dosyada satır bulunamadı.', 'error'); status(''); return; }

      // Doğrula
      const valid = [];
      const skipped = [];
      rawRows.slice(0, 2000).forEach((r, i) => {
        const date = parseDate(r.date);
        const type = parseType(r.type);
        const amount = parseAmount(r.amount);
        const fromAcc = findAccount(r.account);
        if (!date || !type || !(amount > 0) || !fromAcc) {
          skipped.push(i + 2);
          return;
        }
        if (type === 'transfer') {
          const toAcc = findAccount(r.to);
          if (!toAcc || toAcc.id === fromAcc.id) { skipped.push(i + 2); return; }
          valid.push({ type, amount, date, fromAcc, toAcc, desc: String(r.desc || 'Hesap Transferi') });
        } else {
          valid.push({ type, amount, date, fromAcc, desc: String(r.desc || 'Açıklama yok'), category: String(r.category || '📋 Diğer') });
        }
      });
      if (!valid.length) {
        showToast(`${skipped.length} satır atlandı, geçerli satır yok. Şablonu inceleyin.`, 'error');
        status('');
        return;
      }
      if (!confirm(`${valid.length} işlem eklenecek${skipped.length ? `, ${skipped.length} satır atlanacak` : ''}. Onaylıyor musun?`)) { status(''); return; }

      // Yaz (500'lük batch'ler) + bakiye güncelle
      status(`Yazılıyor: 0/${valid.length}...`);
      const balances = {};
      accounts.forEach(a => { balances[a.id] = Number(a.balance || 0); });
      const userRef = db.collection('users').doc(currentUser.uid);
      const ts = firebase.firestore.FieldValue.serverTimestamp();
      let done = 0;
      for (let i = 0; i < valid.length; i += 400) {
        const batch = db.batch();
        for (const v of valid.slice(i, i + 400)) {
          if (v.type === 'transfer') {
            const ref = userRef.collection('transfers').doc();
            batch.set(ref, {
              fromAccountId: v.fromAcc.id, fromAccountName: v.fromAcc.name,
              toAccountId: v.toAcc.id, toAccountName: v.toAcc.name,
              amount: v.amount, description: v.desc, date: v.date, createdAt: ts
            });
            balances[v.fromAcc.id] -= v.amount;
            balances[v.toAcc.id] = (balances[v.toAcc.id] ?? Number(v.toAcc.balance || 0)) + v.amount;
          } else {
            const ref = userRef.collection('transactions').doc();
            batch.set(ref, {
              type: v.type, amount: v.amount, category: v.category, description: v.desc,
              date: v.date, accountId: v.fromAcc.id, accountName: v.fromAcc.name,
              accountCurrency: v.fromAcc.currency || 'TRY', createdAt: ts
            });
            balances[v.fromAcc.id] += v.type === 'income' ? v.amount : -v.amount;
          }
        }
        // Bakiye güncellemeleri (bu chunk'ta dokunulan hesaplar)
        const touched = new Set();
        valid.slice(i, i + 400).forEach(v => { touched.add(v.fromAcc.id); if (v.toAcc) touched.add(v.toAcc.id); });
        touched.forEach(id => batch.update(userRef.collection('accounts').doc(id), { balance: balances[id] }));
        await batch.commit();
        done += Math.min(400, valid.length - i);
        status(`Yazılıyor: ${done}/${valid.length}...`);
      }
      status('');
      await loadUserData();
      showToast(`${valid.length} işlem eklendi${skipped.length ? `, ${skipped.length} satır atlandı` : ''}.`, 'success');
    } catch (e) {
      status('');
      showToast('İçe aktarma hatası: ' + e.message, 'error');
    }
    document.getElementById('importTableFile').value = '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('exportCsvBtn')?.addEventListener('click', downloadCSV);
    document.getElementById('exportXlsxBtn')?.addEventListener('click', downloadXLSX);
    document.getElementById('importTemplateBtn')?.addEventListener('click', downloadTemplate);
    document.getElementById('importTableFile')?.addEventListener('change', e => importTableFile(e.target.files[0]));
  });
})();
