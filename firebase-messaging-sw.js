// FCM arka plan service worker'ı. Sitenin kökünde durmalı (index.html ile aynı klasör).
// https (veya localhost) gerekir; file:// ile çalışmaz.
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'AIzaSyCmBhsXLkFjQnTdNYXH2IEOAUxAllKOXyA',
    projectId: 'bizzness-in-muhasebesi',
    messagingSenderId: '140794309361',
    appId: '1:140794309361:web:bd6fa42aa10f0e971e9750'
});

const messaging = firebase.messaging();

// Uygulama kapalıyken gelen push burada gösterilir.
messaging.onBackgroundMessage((payload) => {
    const title = (payload && payload.notification && payload.notification.title) || 'Finora';
    const body = (payload && payload.notification && payload.notification.body) || 'Yeni bildiriminiz var.';
    self.registration.showNotification(title, { body });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(clients.openWindow('./'));
});
