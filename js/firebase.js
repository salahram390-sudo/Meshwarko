import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { initializeFirestore, getFirestore, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyBY72SkEi6HX4R9fSYAQhnYCLVbPu-W4Ko",
  authDomain: "meshwarkomm.firebaseapp.com",
  projectId: "meshwarkomm",
  storageBucket: "meshwarkomm.firebasestorage.app",
  messagingSenderId: "889669815551",
  appId: "1:889669815551:web:b47e9dcf775e4c1eff10ca",
  measurementId: "G-SDWD0EMRRF",
};

export const app = initializeApp(firebaseConfig);

let db;
try {
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false,
  });
} catch (_) {
  db = getFirestore(app);
}
export const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Auth persistence warning:", err?.message || err);
});

export { db };

window.__auth = auth;
window.__db = db;

export let messaging = null;

export async function initFirebaseMessaging(uid) {
  // OneSignal handles all push notifications
  // FCM is disabled to avoid Service Worker scope conflict
  console.log("FCM skipped — OneSignal handles push notifications");
  return null;
}
export function listenForegroundMessages(cb) {
  // OneSignal handles all messages — FCM listener removed
  return;
}
