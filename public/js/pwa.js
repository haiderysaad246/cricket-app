if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const SW_URL = "/service-worker.js?v=13";
    navigator.serviceWorker.register(SW_URL).catch(() => null);
  });
}