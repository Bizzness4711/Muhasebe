// FCM web push: izinli cihaza token alıp Firestore'a yazar, ön planda geleni gösterir.
// ÖN KOŞUL: aşağıdaki VAPID anahtarını doldur.
// Firebase Console > Proje Ayarları > Cloud Messaging > Web Push sertifikaları > Anahtar oluştur.
const FCM_VAPID_KEY = 'BGXJEnJGws5yvMXZcWJCGsEflmMCwhSsmIQBXu4xchTqoGiIXdjhnaGbL2kRaNp_uU_4_aQB7jkoBJObsaZXuMU';

async function initPush() {
    try {
        if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
        if (typeof firebase === 'undefined' || !firebase.messaging) return;
        if (typeof currentUser === 'undefined' || !currentUser) return;
        if (!FCM_VAPID_KEY || FCM_VAPID_KEY.indexOf('PASTE') !== -1) {
            console.warn('FCM VAPID anahtarı girilmeden push çalışmaz (js/push.js).');
            return;
        }
        const reg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
        const messaging = firebase.messaging();
        if (Notification.permission !== 'granted') return;
        const token = await messaging.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
        if (token) {
            await db.collection('users').doc(currentUser.uid).collection('pushTokens').doc(token).set({
                platform: navigator.platform || '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
        // Uygulama açıkken gelen push: bildirim merkezine düşer + ses çalar.
        messaging.onMessage((payload) => {
            const body = (payload && payload.notification && payload.notification.body) || 'Yeni bildiriminiz var.';
            if (typeof addNotification === 'function') addNotification(`push-${Date.now()}`, body, 'fa-bell');
            else if (typeof playNotificationSound === 'function') playNotificationSound();
        });
        if (typeof messaging.onTokenRefresh === 'function') {
            messaging.onTokenRefresh(async () => {
                try {
                    const t = await messaging.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
                    if (t && currentUser) {
                        await db.collection('users').doc(currentUser.uid).collection('pushTokens').doc(t).set({ platform: navigator.platform || '' }, { merge: true });
                    }
                } catch (e) { console.warn('Push token yenilenemedi.', e); }
            });
        }
    } catch (e) {
        console.warn('Push başlatılamadı.', e);
    }
}
