// Self-destructing worker: cleans up the old PWA service worker + all
// its caches for any browser that still has it installed, then removes
// itself. Safe to delete this file (and the registration calls above)
// once you're confident all returning users have been cleaned up.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: "window" });
      clientsList.forEach((client) => client.navigate(client.url));
    })()
  );
});