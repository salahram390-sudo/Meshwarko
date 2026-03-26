import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { initializeFirestore, getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

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
    experimentalForceLongPolling: true,
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

export async function initFirebaseMessaging() {
  try {
    const supported = await isSupported();
    if (!supported) return null;

    messaging = getMessaging(app);

    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("Notification permission not granted");
      return null;
    }

    const token = await getToken(messaging, {
      vapidKey: "PUT_YOUR_FIREBASE_WEB_PUSH_CERTIFICATE_KEY_HERE",
      serviceWorkerRegistration: registration
    });

    console.log("FCM TOKEN:", token);
    return token;
  } catch (err) {
    console.warn("FCM init error:", err);
    return null;
  }
}

export function listenForegroundMessages(cb) {
  if (!messaging) return;
  onMessage(messaging, (payload) => {
    console.log("Foreground message:", payload);
    if (typeof cb === "function") cb(payload);
  });
}
