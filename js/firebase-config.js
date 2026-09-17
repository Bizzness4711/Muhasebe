// Firebase yapılandırması
const firebaseConfig = {
    apiKey: "AIzaSyCmBhsXLkFjQnTdNYXH2IEOAUxAllKOXyA",
    authDomain: "bizzness-in-muhasebesi.firebaseapp.com",
    projectId: "bizzness-in-muhasebesi",
    storageBucket: "bizzness-in-muhasebesi.firebasestorage.app",
    messagingSenderId: "140794309361",
    appId: "1:140794309361:web:bd6fa42aa10f0e971e9750",
    measurementId: "G-E5XMM1PBVC"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let accounts = [];
let transactions = [];
let transfers = [];
let recurringTransactions = [];
let goals = [];
let selectedType = 'expense';
let currentCurrency = 'TRY';
let selectedAccounts = new Set();
let currentMonth = new Date().toISOString().substring(0, 7);
let reportPeriod = 'month';
let currentThemeColor = '#9C27B0';
let exchangeRates = { TRY: 1, USD: 0, EUR: 0, GRAM_ALTIN: 0, CEYREK_ALTIN: 0 };
let isHidden = false;
let totalBalanceVisible = false;
let privacyModeUnsubscribe = null;
let securityTimeoutId = null;
let securityLocked = false;
let securityActivityBound = false;
let rateRefreshIntervalId = null;
let editingTransactionId = null;
let recurringProcessingPromise = null;
let notifications = [];
let budgets = [];
let customCategories = [];

const DEFAULT_CATEGORIES = {
    expense: ['🍔 Yemek', '🚗 Ulaşım', '🏠 Kira', '💡 Faturalar', '🛒 Market', '🎮 Eğlence', '💊 Sağlık', '📚 Eğitim', '👕 Giyim', '📱 Teknoloji', '🎁 Hediyeler', '📋 Diğer'],
    income: ['💰 Maaş', '💼 Serbest Çalışma', '📈 Yatırım', '🎁 Hediye', '🏠 Kira Geliri', '📋 Diğer']
};

// Özel kategoriler: ilk girişte varsayılanlar tohumlanır, sonra kullanıcı yönetir.
async function loadCategories() {
    customCategories = [];
    if (!currentUser) return;
    try {
        const snap = await db.collection('users').doc(currentUser.uid).collection('categories').get();
        snap.forEach(doc => customCategories.push({ id: doc.id, ...doc.data() }));
        if (!customCategories.length) {
            for (const type of ['expense', 'income']) {
                for (const name of DEFAULT_CATEGORIES[type]) {
                    const ref = await db.collection('users').doc(currentUser.uid).collection('categories').add({ name, type, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                    customCategories.push({ id: ref.id, name, type });
                }
            }
        }
    } catch (error) {
        console.warn('Kategoriler yüklenemedi.', error);
        customCategories = [];
    }
}

