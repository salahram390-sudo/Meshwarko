// Minimal Service Worker for testing
console.log("✅ Service Worker Loaded Successfully");

self.addEventListener("install", () => {
  console.log("🔧 SW Installed");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("🔧 SW Activated");
  event.waitUntil(self.clients.claim());
});

// Test notification
self.addEventListener("push", (event) => {
  console.log("📩 Push event received");
  const options = {
    body: "Test notification from SW",
    icon: "/Meshwarko/logo.png"
  };
  event.waitUntil(self.registration.showNotification("مشوارك", options));
});
