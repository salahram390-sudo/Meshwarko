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

messaging.onBackgroundMessage(function (payload) {
  var title = "مشوارك";
  if (payload && payload.notification && payload.notification.title) {
    title = payload.notification.title;
  }

  var body = "لديك إشعار جديد";
  if (payload && payload.notification && payload.notification.body) {
    body = payload.notification.body;
  }

  var data = {};
  if (payload && payload.data) {
    data = payload.data;
  }

  var targetUrl = "./index.html";
  if (data.url) {
    targetUrl = data.url;
  }

  var options = {
    body: body,
    icon: "./assets/logo.png",
    badge: "./assets/logo.png",
    data: Object.assign({}, data, { url: targetUrl })
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var targetUrl = "./index.html";
  if (event.notification && event.notification.data && event.notification.data.url) {
    targetUrl = event.notification.data.url;
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
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
