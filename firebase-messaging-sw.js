importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

try {
  firebase.initializeApp({
    apiKey: "AIzaSyBY72SkEi6HX4R9fSYAQhnYCLVbPu-W4Ko",
    authDomain: "meshwarkomm.firebaseapp.com",
    projectId: "meshwarkomm",
    storageBucket: "meshwarkomm.firebasestorage.app",
    messagingSenderId: "889669815551",
    appId: "1:889669815551:web:b47e9dcf775e4c1eff10ca"
  });

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log("📩 Background message received:", payload);
    const title = payload.notification?.title || payload.data?.title || "مشوارك";
    const body = payload.notification?.body || payload.data?.body || "لديك طلب جديد";

    const options = {
      body: body,
      icon: "/Meshwarko/logo.png",
      badge: "/Meshwarko/logo.png",
      vibrate: [200, 100, 200],
      tag: "meshwark-notification",
      data: { url: "/Meshwarko/driver.html" }
    };

    return self.registration.showNotification(title, options);
  });

  console.log("✅ Firebase Messaging SW initialized successfully");

} catch (e) {
  console.error("❌ Error in SW:", e);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data.url || "/Meshwarko/driver.html";
  event.waitUntil(clients.openWindow(url));
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
