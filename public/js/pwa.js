(() => {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("/service-worker.js")
    .catch((error) => console.error("service_worker_registration_failed", error));
})();
