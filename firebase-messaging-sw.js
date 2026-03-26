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

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "مشوارك";
  const options = {
    body: payload?.notification?.body || "لديك إشعار جديد",
    icon: "./assets/logo.png",
    badge: "./assets/logo.png",
    data: {
      url: payload?.data?.url || "./index.html",
      ...payload?.data
    }
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "./index.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
