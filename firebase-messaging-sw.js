console.log("✅ TEST SW LOADED");

self.addEventListener("install", () => {
  console.log("✅ TEST SW INSTALLED");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("✅ TEST SW ACTIVATED");
  event.waitUntil(self.clients.claim());
});
