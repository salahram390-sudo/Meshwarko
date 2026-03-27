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

export async function initFirebaseMessaging(uid) {
  try {
    console.log("FCM START, uid =", uid);

    if (!uid) {
      console.warn("FCM skipped: uid missing");
      return null;
    }

    if (!("serviceWorker" in navigator)) {
      console.warn("Service worker not supported");
      return null;
    }

    const supported = await isSupported();
    console.log("FCM supported =", supported);

    if (!supported) {
      console.warn("Firebase messaging not supported on this browser");
      return null;
    }

    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    console.log("SW registered =", registration);

    messaging = getMessaging(app);

    const permission = await Notification.requestPermission();
    console.log("Notification permission =", permission);

    if (permission !== "granted") {
      console.warn("Notification permission not granted");
      return null;
    }

    const token = await getToken(messaging, {
      vapidKey: "BMmr4DfucDSm0JzDoBhUTp7v5xagCgBFpSmqgmNmAPJUSUJ8S9ga49SlJQRvxillsIeE4_isvJkPAsNxg4Y0uws",
      serviceWorkerRegistration: registration,
    });

    console.log("FCM raw token =", token);

    if (!token) {
      console.warn("No FCM token returned");
      return null;
    }

    await updateDoc(doc(db, "users", uid), {
      fcmToken: token,
      fcmUpdatedAt: serverTimestamp(),
    }).catch((err) => {
      console.warn("Saving FCM token failed:", err?.message || err);
    });

    console.log("FCM TOKEN SAVED:", token);
    return token;
  } catch (err) {
    console.warn("FCM init error:", err?.message || err);
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
