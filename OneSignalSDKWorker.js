importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
// ⚙️ إعدادات إضافية للإشعارات
self.addEventListener("notificationwillshow", (event) => {
  if (event.notification) {
    event.notification.silent = false;
    event.notification.vibrate = [200, 100, 200];
    event.notification.requireInteraction = true;
    event.notification.renotify = true;
  }
});
