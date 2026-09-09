console.log("STEP 1 - SW START");

importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");

console.log("STEP 2 - FIREBASE APP LOADED");

importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

console.log("STEP 3 - FIREBASE MESSAGING LOADED");

firebase.initializeApp({
  apiKey: "AIzaSyBY72SkEi6HX4R9fSYAQhnYCLVbPu-W4Ko",
  authDomain: "meshwarkomm.firebaseapp.com",
  projectId: "meshwarkomm",
  storageBucket: "meshwarkomm.firebasestorage.app",
  messagingSenderId: "889669815551",
  appId: "1:889669815551:web:b47e9dcf775e4c1eff10ca"
});

console.log("STEP 4 - FIREBASE INITIALIZED");

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("STEP 5 - BACKGROUND MESSAGE", payload);

  const title = payload.notification?.title || "مشوارك";
  const body = payload.notification?.body || "لديك إشعار جديد";

  self.registration.showNotification(title, {
    body: body,
    icon: "/Meshwarko/assets/logo.png",
    badge: "/Meshwarko/assets/logo.png"
  });
});
