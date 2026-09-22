// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "meshwarkomm.firebaseapp.com",
  projectId: "meshwarkomm",
  storageBucket: "meshwarkomm.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc123"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Background:', payload);
  const title = payload.notification?.title || 'إشعار جديد';
  const options = {
    body: payload.notification?.body || 'لديك رسالة جديدة',
    icon: '/assets/avatar.png'
  };
  self.registration.showNotification(title, options);
});
