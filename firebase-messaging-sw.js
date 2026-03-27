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

self.addEventListener("install", function (event) {
  console.log("SW install OK");
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  console.log("SW activate OK");
  event.waitUntil(self.clients.claim());
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var title = "مشوارك";
  var body = "لديك إشعار جديد";

  if (payload && payload.notification && payload.notification.title) {
    title = payload.notification.title;
  }

  if (payload && payload.notification && payload.notification.body) {
    body = payload.notification.body;
  }

  self.registration.showNotification(title, {
    body: body,
    icon: "./assets/logo.png"
  });
});
