importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBY72SkEi6HX4R9fSYAQhnYCLVbPu-W4Ko",
  authDomain: "meshwarkomm.firebaseapp.com",
  projectId: "meshwarkomm",
  storageBucket: "meshwarkomm.firebasestorage.app",
  messagingSenderId: "889669815551",
  appId: "1:889669815551:web:b47e9dcf775e4c1eff10ca",
  measurementId: "G-SDWD0EMRRF"
});

const messaging = firebase.messaging();

self.addEventListener("install", function (event) {
  console.log("SW install OK");
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  console.log("SW activate OK");
  event.waitUntil(self.clients.claim());
});

// 🔥 الجزء المهم: Background Message
messaging.onBackgroundMessage(function (payload) {
  console.log("📩 Background message received:", payload);

  let title = "مشوارك";
  let body = "لديك طلب جديد";
  let icon = "./logo.png";           // أو "./assets/logo.png"
  let clickAction = "/driver.html";  // مهم عشان يفتح الصفحة

  // استخراج البيانات من الـ notification أو الـ data
  if (payload.notification) {
    title = payload.notification.title || title;
    body = payload.notification.body || body;
  }

  if (payload.data) {
    if (payload.data.title) title = payload.data.title;
    if (payload.data.body) body = payload.data.body;
    if (payload.data.click_action) clickAction = payload.data.click_action;
  }

  const options = {
    body: body,
    icon: icon,
    badge: "./logo.png",
    vibrate: [200, 100, 200],
    data: {
      url: clickAction
    }
  };

  return self.registration.showNotification(title, options);
});

// عند الضغط على الإشعار
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        if (clientList.length > 0) {
          return clientList[0].focus();
        }
        return clients.openWindow(event.notification.data.url || "/driver.html");
      })
  );
});
