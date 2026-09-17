/**
 * E-posta Bildirim Modülü — Finora
 *
 * MİMARİ:
 *  - template_qygarf7  → Detaylı bütçe uyarıları (kategori, tutarlar, detay tablosu)
 *  - templateSimple    → Basit bildirimler (hedef, hoş geldin, işlem, genel)
 *
 * NOT: EmailJS ücretsiz planı {{#if}} koşullarını ve değişken içinde HTML render
 * etmeyi desteklemediği için HTML tamamen şablonlarda tanımlıdır.
 */

const _emailConfig = {
    serviceId: 'service_0mnyndc',
    templateId: 'template_qygarf7',                    // Detaylı bütçe uyarı şablonu
    templateSimple: 'template_0g9xw1v',     // ← YENİ basit şablon ID'si (EmailJS panelinden kopyalayın)
    publicKey: 'FhUY7VzWUIrkz5k2z',
};

/* Uygulama URL'si — CTA butonları buraya yönlendirir */
const APP_URL = 'https://bizzness4711.github.io/Muhasebe/';

function isEmailNotificationsEnabled() {
    return true; // ponytail: e-posta zorunlu, toggle kaldirildi
}

function _emailConfigured() {
    return _emailConfig.serviceId && _emailConfig.templateId && _emailConfig.publicKey;
}

function initEmailJS() {
    if (typeof emailjs !== 'undefined' && _emailConfigured()) {
        try { emailjs.init({ publicKey: _emailConfig.publicKey }); } catch (e) {}
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEmailJS);
} else {
    initEmailJS();
}

/* ==========================================================
   YARDIMCILAR
   ========================================================== */
function _fmtTL(n) {
    return '₺' + Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _monthLabel(monthStr) {
    if (!monthStr) return '';
    var parts = monthStr.split('-');
    var y = parts[0], m = parseInt(parts[1], 10);
    var names = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    return names[m - 1] + ' ' + y;
}

function _nowLabel() {
    var d = new Date();
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) + ', ' +
           d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

/* ==========================================================
   ANA GÖNDERİM FONKSİYONU
   @param params    → E-posta içeriği
   @param useSimple → true ise basit şablon, false/undefined ise detaylı bütçe şablonu
   ========================================================== */
async function sendEmailNotification(params, useSimple) {
    if (!isEmailNotificationsEnabled()) {
        console.log('[Email] Bildirimler kapalı.');
        return false;
    }
    if (!_emailConfigured()) {
        console.warn('[Email] EmailJS yapılandırılmamış.');
        return false;
    }
    var user = typeof auth !== 'undefined' ? auth.currentUser : null;
    if (!user || !user.email) {
        console.warn('[Email] Kullanıcı e-postası yok.');
        return false;
    }
    if (typeof emailjs === 'undefined') {
        console.warn('[Email] EmailJS SDK yok.');
        return false;
    }

    var payload = {
        to_email: user.email,
        subject: params.subject || 'Finora Bildirimi',
        badge_text: params.badge_text || 'BİLDİRİM',
        badge_bg: params.badge_bg || '#eee9ff',
        badge_color: params.badge_color || '#6256d9',
        category: params.category || '',
        period_label: params.period_label || '',
        message_text: params.message_text || '',
        extra_heading: params.extra_heading || '',
        extra_text: params.extra_text || '',
        extra_tip: params.extra_tip || '',
        stat1_label: params.stat1_label || '',
        stat1_value: params.stat1_value || '',
        stat1_color: params.stat1_color || '#6256d9',
        stat2_label: params.stat2_label || '',
        stat2_value: params.stat2_value || '',
        stat2_color: params.stat2_color || '#d95768',
        stat3_label: params.stat3_label || '',
        stat3_value: params.stat3_value || '',
        stat3_color: params.stat3_color || '#159a72',
        progress_pct: params.progress_pct || 0,
        progress_color: params.progress_color || '#d08a25',
        budget_amount: params.budget_amount || '',
        spent_amount: params.spent_amount || '',
        diff_label: params.diff_label || '',
        diff_amount: params.diff_amount || '',
        diff_color: params.diff_color || '#159a72',
        alert_date: params.alert_date || _nowLabel(),
        alert_bg: params.alert_bg || '#fef4e5',
        alert_border: params.alert_border || '#d08a25',
        alert_color: params.alert_color || '#8a6517',
        alert_text: params.alert_text || '',
        cta_url: params.cta_url || APP_URL,
        cta_text: params.cta_text || 'Uygulamayı Aç',
        footer_text: params.footer_text || 'Finora tarafından otomatik gönderilmiştir.'
    };

    var templateId = (useSimple === true) ? _emailConfig.templateSimple : _emailConfig.templateId;

    try {
        console.log('[Email] Gönderiliyor:', { template: templateId, subject: payload.subject });
        var result = await emailjs.send(_emailConfig.serviceId, templateId, payload);
        console.log('[Email] Gönderildi:', result);
        return true;
    } catch (err) {
        console.error('[Email] HATA:', err);
        return false;
    }
}

/* ==========================================================
   BÜTÇE UYARISI → DETAYLI ŞABLON (useSimple YOK)
   ========================================================== */
async function sendBudgetAlertEmail(category, pct, spent, limit, isOver) {
    var remaining = Math.max(0, limit - spent);
    var overspend = Math.max(0, spent - limit);
    var monthLabel = (typeof currentMonth !== 'undefined' && currentMonth)
        ? _monthLabel(currentMonth)
        : _monthLabel(new Date().toISOString().slice(0, 7));

    if (isOver) {
        return sendEmailNotification({
            subject: 'Bütçe Aşımı Uyarısı',
            badge_text: 'AŞIM',
            badge_bg: '#fde8ec',
            badge_color: '#d95768',
            category: category,
            period_label: monthLabel + ' dönemi',
            message_text: 'Bütçe limitinizi aştınız. Harcama alışkanlıklarınızı gözden geçirmenizi öneririz.',
            stat1_label: 'Bütçe', stat1_value: _fmtTL(limit), stat1_color: '#6256d9',
            stat2_label: 'Harcanan', stat2_value: _fmtTL(spent), stat2_color: '#d95768',
            stat3_label: 'Aşım', stat3_value: _fmtTL(overspend), stat3_color: '#d95768',
            progress_pct: 100,
            progress_color: '#d95768',
            budget_amount: _fmtTL(limit),
            spent_amount: _fmtTL(spent),
            diff_label: 'Aşım Tutarı',
            diff_amount: '+' + _fmtTL(overspend),
            diff_color: '#d95768',
            alert_date: _nowLabel(),
            alert_bg: '#fde8ec',
            alert_border: '#d95768',
            alert_color: '#a63d50',
            alert_text: 'Bu kategoride belirlenen bütçe limitinizin üzerine çıktınız. Diğer kategorilerdeki harcamalarınızı gözden geçirerek denge sağlayabilirsiniz.',
            cta_url: APP_URL,
            cta_text: 'Uygulamada Görüntüle',
            footer_text: 'Bu e-posta Finora bütçe takip sistemi tarafından otomatik olarak gönderilmiştir.'
        }); // ← useSimple YOK, detaylı şablon kullanılır
    } else {
        return sendEmailNotification({
            subject: 'Bütçe Kullanım Uyarısı',
            badge_text: 'UYARI',
            badge_bg: '#fef4e5',
            badge_color: '#d08a25',
            category: category,
            period_label: monthLabel + ' dönemi',
            message_text: 'Bütçe limitinizin %' + pct.toFixed(0) + '\'ını kullandınız. Kalan harcamalarınızı planlamanızı öneririz.',
            stat1_label: 'Bütçe', stat1_value: _fmtTL(limit), stat1_color: '#6256d9',
            stat2_label: 'Harcanan', stat2_value: _fmtTL(spent), stat2_color: '#d08a25',
            stat3_label: 'Kalan', stat3_value: _fmtTL(remaining), stat3_color: '#159a72',
            progress_pct: Math.min(100, pct),
            progress_color: '#d08a25',
            budget_amount: _fmtTL(limit),
            spent_amount: _fmtTL(spent),
            diff_label: 'Kalan Bütçe',
            diff_amount: _fmtTL(remaining),
            diff_color: '#159a72',
            alert_date: _nowLabel(),
            alert_bg: '#fef4e5',
            alert_border: '#d08a25',
            alert_color: '#8a6517',
            alert_text: 'Bütçenizin büyük bir kısmını kullandınız. Ayın kalan günlerinde harcamalarınıza dikkat ederek limitinizi aşmaktan kaçınabilirsiniz.',
            cta_url: APP_URL,
            cta_text: 'Bütçeyi İncele',
            footer_text: 'Bu e-posta Finora bütçe takip sistemi tarafından otomatik olarak gönderilmiştir.'
        }); // ← useSimple YOK
    }
}

/* ==========================================================
   HEDEF TAMAMLANDI → BASİT ŞABLON (true)
   ========================================================== */
async function sendGoalReachedEmail(goalName, targetAmount) {
    return sendEmailNotification({
        subject: 'Hedef Tamamlandı!',
        badge_text: 'TEBRİKLER',
        badge_bg: '#e8f8f2',
        badge_color: '#159a72',
        message_text: 'Tebrikler! "' + goalName + '" tasarruf hedefinize ulaştınız. Hedef tutarı: ' + _fmtTL(targetAmount) + '. Yeni bir hedef belirleyerek finansal yolculuğunuza devam edin!',
        footer_text: 'Bu e-posta Finora hedef takibi tarafından gönderilmiştir.'
    }, true); // ← BASİT ŞABLON
}

/* ==========================================================
   HOŞ GELDİN → BASİT ŞABLON (true)
   ========================================================== */
async function sendWelcomeEmail(userName) {
    var today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    return sendEmailNotification({
        subject: 'Finora\'ya Hoş Geldiniz!',
        badge_text: 'HOŞ GELDİNİZ',
        badge_bg: '#eee9ff',
        badge_color: '#6256d9',
        message_text: 'Merhaba ' + (userName || 'Kullanıcı') + ',\n\nFinora ailesine katıldığınız için teşekkür ederiz! ' + today + ' tarihinde oluşturduğunuz hesabınızla finansal yolculuğunuza başlıyorsunuz. Size en iyi deneyimi sunmak için birkaç önemli noktayı aşağıda paylaştık.',
        extra_heading: '🎯 Finora ile Neler Yapabilirsiniz?',
        extra_text: '✅ Gelir ve giderlerinizi kolayca kaydedin\n✅ Kategorilere göre bütçe limitleri belirleyin\n✅ Tasarruf hedefleri oluşturun ve takip edin\n✅ Döviz ve altın varlıklarınızı anlık izleyin\n✅ Kredi kartı taksitlerinizi tek ekranda yönetin\n✅ Aylık detaylı raporlar ve grafikler alın\n✅ PIN kilidi ve gizlilik modu ile güvende kalın',
        extra_tip: '💡 İpucu: İlk işlem kaydınızı bugün oluşturun. Finora otomatik olarak aylık raporunuzu hazırlamaya başlayacaktır.',
        cta_url: APP_URL,
        cta_text: 'Finora\'ya Git →',
        footer_text: 'Bu e-posta Finora hesabınız oluşturulduğu için gönderilmiştir. Sorularınız için bize ulaşabilirsiniz.'
    }, true);
}

/* ==========================================================
   YENİ İŞLEM → BASİT ŞABLON (true)
   ========================================================== */
async function sendTransactionEmail(type, category, amount, description) {
    var isIncome = type === 'income';
    var text = (isIncome ? 'Yeni bir gelir kaydı oluşturuldu.' : 'Yeni bir harcama kaydı oluşturuldu.');
    text += '\n\nKategori: ' + (category || 'Belirtilmemiş');
    text += '\nTutar: ' + _fmtTL(amount);
    if (description) text += '\nAçıklama: ' + description;

    return sendEmailNotification({
        subject: isIncome ? 'Yeni Gelir Kaydı' : 'Yeni Harcama Kaydı',
        badge_text: isIncome ? 'GELİR' : 'HARCAMA',
        badge_bg: isIncome ? '#e8f8f2' : '#fde8ec',
        badge_color: isIncome ? '#159a72' : '#d95768',
        message_text: text,
        footer_text: 'Bu e-posta Finora işlem bildirimi tarafından gönderilmiştir.'
    }, true); // ← BASİT ŞABLON
}

/* ==========================================================
   GENEL BİLDİRİM → BASİT ŞABLON (true)
   ========================================================== */
async function sendGenericAlertEmail(title, message, options) {
    options = options || {};
    return sendEmailNotification({
        subject: title,
        badge_text: options.badgeText || 'BİLDİRİM',
        badge_bg: options.badgeBg || '#eee9ff',
        badge_color: options.badgeColor || '#6256d9',
        message_text: message,
        footer_text: options.footerNote || 'Bu e-posta Finora tarafından gönderilmiştir.'
    }, true); // ← BASİT ŞABLON
}