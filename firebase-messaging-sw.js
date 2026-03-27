self.addEventListener("install", function (event) {
  console.log("SW install OK");
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  console.log("SW activate OK");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
});
