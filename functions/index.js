const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

exports.deleteUserByAdmin = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  const targetUid = request.data?.uid;

  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Oturum açmanız gerekiyor.');
  }
  if (!targetUid || typeof targetUid !== 'string') {
    throw new HttpsError('invalid-argument', 'Geçerli bir kullanıcı UID gerekli.');
  }
  if (callerUid === targetUid) {
    throw new HttpsError('failed-precondition', 'Kendi admin hesabınızı bu işlemle silemezsiniz.');
  }

  const db = getFirestore();
  const callerSnap = await db.collection('users').doc(callerUid).get();
  if (!callerSnap.exists || callerSnap.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Bu işlem yalnızca admin kullanıcılar içindir.');
  }

  try {
    await getAuth().deleteUser(targetUid);
    await db.recursiveDelete(db.collection('users').doc(targetUid));
    return { success: true };
  } catch (error) {
    console.error('Admin kullanıcı silme hatası:', error);
    throw new HttpsError('internal', 'Kullanıcı tamamen silinemedi.');
  }
});
