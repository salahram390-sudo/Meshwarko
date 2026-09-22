// firebase-messaging-sw.js
// استيراد مكتبات Firebase المتوافقة مع الـ Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

// كائن الإعدادات بتاع مشروعك على Firebase
const firebaseConfig = {
  apiKey: "YOUR_API_KEY", // استبدل دي بقيمك الحقيقية
  authDomain: "meshwarkomm.firebaseapp.com",
  projectId: "meshwarkomm",
  storageBucket: "meshwarkomm.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID", // استبدل دي بقيمك الحقيقية
  appId: "YOUR_APP_ID" // استبدل دي بقيمك الحقيقية
};

// تهيئة Firebase
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// معالجة الرسائل في الخلفية
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification?.title || 'إشعار جديد';
  const notificationOptions = {
    body: payload.notification?.body || 'لديك رسالة جديدة.',
    icon: '/assets/avatar.png' // تأكد إن المسار ده صح
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});
