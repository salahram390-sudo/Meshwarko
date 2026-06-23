console.log("✅ Minimal Service Worker Loaded");

self.addEventListener("install", () => {
  console.log("🔧 SW Installed");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("🔧 SW Activated");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  console.log("📩 Push received");
  const options = {
    body: "Test notification - SW working",
    icon: "/Meshwarko/logo.png"
  };
  event.waitUntil(self.registration.showNotification("مشوارك", options));
});
