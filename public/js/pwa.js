(() => {
  let installPrompt = null;
  let installButton;

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);

  function hideInstallButton() {
    if (installButton) installButton.hidden = true;
  }

  function showInstallButton() {
    if (installButton) installButton.hidden = false;
  }

  function createInstallButton() {
    if (installButton || isStandalone()) return;

    installButton = document.createElement("button");
    installButton.type = "button";
    installButton.textContent = "Install app";
    installButton.setAttribute("aria-label", "Install Cricket app");
    Object.assign(installButton.style, {
      position: "fixed",
      top: "16px",
      left: "16px",
      zIndex: "1050",
      border: "0",
      borderRadius: "999px",
      padding: "9px 16px",
      background: "#1f1f1f",
      color: "#fff",
      font: "600 13px system-ui, sans-serif",
      boxShadow: "0 4px 12px rgba(0,0,0,.25)",
      cursor: "pointer",
    });
    installButton.hidden = true;
    installButton.addEventListener("click", async () => {
      if (!installPrompt) {
        if (isIos) {
          window.alert("To install the app, tap Share in your browser, then choose Add to Home Screen.");
        }
        return;
      }

      installButton.disabled = true;
      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome === "accepted") hideInstallButton();
        installPrompt = null;
      } catch (error) {
        console.error("pwa_install_prompt_failed", error);
      } finally {
        installButton.disabled = false;
        if (!installPrompt && !isIos) hideInstallButton();
      }
    });
    document.body.appendChild(installButton);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/service-worker.js")
      .catch((error) => console.error("service_worker_registration_failed", error));
  }

  function showIosInstallHelp() {
    if (isIos && !isStandalone()) {
      createInstallButton();
      showInstallButton();
    }
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    createInstallButton();
    showInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    hideInstallButton();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showIosInstallHelp, { once: true });
  } else {
    showIosInstallHelp();
  }

  if (document.readyState === "loading") {
    window.addEventListener("load", registerServiceWorker, { once: true });
  } else {
    registerServiceWorker();
  }
})();