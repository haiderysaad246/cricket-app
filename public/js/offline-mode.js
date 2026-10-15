document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("prepareOfflineBtn");
    const status = document.getElementById("offlineModeStatus");
    if (!button || !status) return;

    function showConnectionState() {
        button.disabled = !navigator.onLine;
        if (!navigator.onLine) status.textContent = "Connect to prepare offline data.";
    }

    async function cachePage(path, cache) {
        const response = await fetch(path, {
            credentials: "same-origin",
            headers: { Accept: "text/html" },
        });
        if (!response.ok || response.redirected) {
            throw new Error(`Could not prepare ${path} (HTTP ${response.status}).`);
        }
        await cache.put(path, response.clone());

        const html = await response.text();
        const documentCopy = new DOMParser().parseFromString(html, "text/html");
        const resources = [...documentCopy.querySelectorAll("script[src], link[rel='stylesheet'][href], img[src]")]
            .map((element) => element.src || element.href)
            .filter((url) => url && new URL(url, location.href).origin === location.origin);
        for (const resourceUrl of new Set(resources)) {
            const resource = new URL(resourceUrl, location.href);
            try {
                if (await caches.match(resource.href)) continue;
                const assetResponse = await fetch(resource.href, { credentials: "same-origin" });
                if (assetResponse.ok && !assetResponse.redirected) {
                    await cache.put(resource.href, assetResponse);
                }
            } catch (error) {
                throw new Error(`Could not cache app resource ${resource.pathname}: ${error.message}`);
            }
        }
    }

    async function prepareOffline() {
        if (!navigator.onLine) {
            status.textContent = "Connect to the internet before preparing offline data.";
            return;
        }

        button.disabled = true;
        try {
            if (navigator.storage && navigator.storage.persist) {
                await navigator.storage.persist();
            }
            status.textContent = "Downloading teams, players, and match records…";
            const response = await fetch("/api/offline/snapshot", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
                cache: "no-store",
            });
            const snapshot = await response.json();
            if (!response.ok) throw new Error(snapshot.error || `Download failed (HTTP ${response.status}).`);
            if (navigator.storage && navigator.storage.estimate) {
                const estimate = await navigator.storage.estimate();
                const requiredBytes = new Blob([JSON.stringify(snapshot)]).size * 1.2;
                const availableBytes = (estimate.quota || 0) - (estimate.usage || 0);
                if (availableBytes && availableBytes < requiredBytes) {
                    throw new Error(`Not enough device storage. About ${Math.ceil(requiredBytes / 1048576)} MB is required; free space and try again.`);
                }
            }
            await window.OfflineStore.saveOfflineSnapshot(snapshot);

            const pages = new Set(["/turfs", "/tcl"]);
            snapshot.turfs.filter((turf) => turf.status === "active")
                .forEach((turf) => pages.add(`/turfs/session/${turf._id}`));
            snapshot.tournaments.filter((tournament) => tournament.status === "active")
                .forEach((tournament) => pages.add(`/tcl/session/${tournament._id}`));
            snapshot.matches.forEach((match) => {
                pages.add(`/turfs/live/${match._id}`);
                const activeTeam = match[match.currentInnings];
                if (match.status === "live" && activeTeam?.strikerId && activeTeam?.nonStrikerId && activeTeam?.currentBowlerId) {
                    pages.add(`/turfs/live/${match._id}/score`);
                }
            });

            const cache = await caches.open("cricket-runtime-v4");
            let completed = 0;
            for (const path of pages) {
                status.textContent = `Preparing offline pages (${completed + 1} of ${pages.size})…`;
                await cachePage(path, cache);
                completed++;
            }
            const counts = [
                `${snapshot.teams.length} teams`,
                `${snapshot.players.length} players`,
                `${snapshot.tournaments.length} tournaments`,
                `${snapshot.turfs.length} Turf sessions`,
                `${snapshot.matches.length} matches`,
            ];
            status.textContent = `Offline data downloaded: ${counts.join(", ")}. Existing match pages are cached; offline turf/match creation is not enabled yet.`;
            document.dispatchEvent(new CustomEvent("offline-data-ready", { detail: snapshot.downloadedAt }));
        } catch (error) {
            console.error("offline_preparation_failed", error);
            status.textContent = `Offline preparation failed: ${error.message}`;
        } finally {
            button.disabled = !navigator.onLine;
        }
    }

    window.OfflineStore.getOfflineSnapshot().then((saved) => {
        if (!saved || status.textContent) return;
        const snapshot = saved.snapshot;
        status.textContent = `Offline data saved ${new Date(snapshot.downloadedAt).toLocaleString()}: ${snapshot.teams.length} teams, ${snapshot.players.length} players, ${snapshot.matches.length} matches.`;
    }).catch((error) => console.error("offline_snapshot_status_failed", error));

    button.addEventListener("click", prepareOffline);
    window.addEventListener("online", showConnectionState);
    window.addEventListener("offline", showConnectionState);
    showConnectionState();
});
