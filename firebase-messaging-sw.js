importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBY72SkEi6HX4R9fSYAQhnYCLVbPu-W4Ko",
  authDomain: "meshwarkomm.firebaseapp.com",
  projectId: "meshwarkomm",
  storageBucket: "meshwarkomm.firebasestorage.app",
  messagingSenderId: "889669815551",
  appId: "1:889669815551:web:b47e9dcf775e4c1eff10ca"
});

const messaging = firebase.messaging();

// 🔥 Background Message Handler
messaging.onBackgroundMessage(function (payload) {
  console.log("📩 Background message received:", payload);

  const notificationTitle = payload.notification?.title || payload.data?.title || "مشوارك";
  const notificationBody  = payload.notification?.body  || payload.data?.body  || "لديك طلب جديد";
  const clickAction = payload.data?.click_action || "/driver.html";

  const options = {
    body: notificationBody,
    icon: "/logo.png",               // تأكد إن logo.png موجود في Root
    badge: "/logo.png",
    vibrate: [200, 100, 200],
    tag: "meshwark-notification",    // مهم جداً
    requireInteraction: false,
    data: { url: clickAction }
  };

  return self.registration.showNotification(notificationTitle, options);
});

// Notification Click Handler
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const urlToOpen = event.notification.data.url || "/passenger.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (let client of clientList) {
        if (client.url.includes(urlToOpen) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(urlToOpen);
    })
  );
});

// Service Worker Install & Activate
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
