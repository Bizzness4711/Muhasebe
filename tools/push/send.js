// Saatlik push hatırlatıcı. GitHub Actions'tan çalışır (FIREBASE_SERVICE_ACCOUNT secret).
// Kontrol ettikleri:
// 1) Yarın vadesi gelen aktif tekrarlayan işlemler
// 2) Bu ay %100'ü aşan bütçeler
// 3) %100'e ulaşan hedefler
// Aynı uyarı iki kez gitmez: users/{uid}/pushLog altına id yazılır, varsa atlanır.
// Tutarlar sunucuda kura çevrilmeden toplanır (yaklaşık değerdir).
const admin = require('firebase-admin');

async function main() {
    const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!keyJson) throw new Error('FIREBASE_SERVICE_ACCOUNT secret yok.');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(keyJson)) });
    const db = admin.firestore();
    const messaging = admin.messaging();

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const month = today.toISOString().split('T')[0].substring(0, 7);
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-31`;

    const usersSnap = await db.collection('users').limit(500).get();
    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const tokensSnap = await db.collection('users').doc(uid).collection('pushTokens').get();
        const tokens = tokensSnap.docs.map(d => d.id);
        if (!tokens.length) continue;

        const bodies = [];
        const batch = db.batch();
        const logRef = (id) => db.collection('users').doc(uid).collection('pushLog').doc(id);
        const isLogged = async (id) => (await logRef(id).get()).exists;

        // 1) Yarın vadesi gelen tekrarlayanlar
        const recSnap = await db.collection('users').doc(uid).collection('recurringTransactions').get();
        for (const doc of recSnap.docs) {
            const r = doc.data();
            if (r.active === false || r.nextDate !== tomorrowStr) continue;
            const id = `rec-${doc.id}-${r.nextDate}`;
            if (await isLogged(id)) continue;
            bodies.push(`Yarın: ${r.description || r.category || 'Tekrarlayan işlem'} (₺${Number(r.amount || 0).toFixed(2)})`);
            batch.set(logRef(id), { at: admin.firestore.FieldValue.serverTimestamp() });
        }

        // 2) Aşan bütçeler (yaklaşık: kur çevrimi yok)
        const budgetSnap = await db.collection('users').doc(uid).collection('budgets').where('month', '==', month).get();
        if (!budgetSnap.empty) {
            const txSnap = await db.collection('users').doc(uid).collection('transactions')
                .where('type', '==', 'expense').where('date', '>=', monthStart).where('date', '<=', monthEnd).get();
            const spentByCat = {};
            txSnap.forEach(d => {
                const t = d.data();
                spentByCat[t.category] = (spentByCat[t.category] || 0) + Number(t.amount || 0);
            });
            for (const doc of budgetSnap.docs) {
                const b = doc.data();
                const limit = Number(b.limit) || 0;
                if (!(limit > 0)) continue;
                const spent = spentByCat[b.category] || 0;
                if (spent >= limit) {
                    const id = `bud-${month}-${b.category}-over`;
                    if (await isLogged(id)) continue;
                    bodies.push(`${b.category} bütçesi aşıldı: ₺${spent.toFixed(2)} / ₺${limit.toFixed(2)}.`);
                    batch.set(logRef(id), { at: admin.firestore.FieldValue.serverTimestamp() });
                }
            }
        }

        // 3) Tamamlanan hedefler
        const goalsSnap = await db.collection('users').doc(uid).collection('goals').get();
        for (const doc of goalsSnap.docs) {
            const g = doc.data();
            if (Number(g.amount) > 0 && Number(g.current) >= Number(g.amount)) {
                const id = `goal-${doc.id}-100`;
                if (await isLogged(id)) continue;
                bodies.push(`Tebrikler! ${g.name} hedefine ulaştın.`);
                batch.set(logRef(id), { at: admin.firestore.FieldValue.serverTimestamp() });
            }
        }

        if (!bodies.length) continue;
        const text = bodies.slice(0, 3).join('\n');
        const res = await messaging.sendEachForMulticast({ tokens, notification: { title: 'Finora', body: text } });
        // Geçersiz tokenları temizle
        const dead = [];
        res.responses.forEach((r, i) => {
            if (!r.success && r.error && r.error.code === 'messaging/registration-token-not-registered') dead.push(tokens[i]);
        });
        for (const t of dead) {
            await db.collection('users').doc(uid).collection('pushTokens').doc(t).delete();
        }
        await batch.commit();
        console.log(`Gönderildi: ${uid} (${bodies.length} uyarı)`);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
