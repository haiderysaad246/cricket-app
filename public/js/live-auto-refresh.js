// Keeps the live match page up to date for viewers without them tapping
// refresh. Admins are left alone here — they already get an instant update
// from their own actions, and a mid-input reload would be disruptive while
// they're picking players or entering a ball.
document.addEventListener('DOMContentLoaded', () => {
    if (window.IS_ADMIN) return; // admins interact live, no need to poll
    const match = window.MATCH;
    if (!match || !match._id) return; // not on a live match page

    const POLL_INTERVAL_MS = 5000;
    let lastUpdatedAt = match.updatedAt;
    let isTabVisible = !document.hidden;
    let isChecking = false;

    document.addEventListener('visibilitychange', () => {
        isTabVisible = !document.hidden;
    });

    async function softRefresh(freshMatch) {
        try {
            const res = await fetch(location.pathname + location.search, { headers: { Accept: 'text/html' } });
            if (res.redirected && new URL(res.url).pathname !== location.pathname) {
                location.href = res.url; // e.g. a Super Over just started
                return true;
            }
            if (!res.ok) return false;
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const swap = (id) => {
                const cur = document.getElementById(id);
                const next = doc.getElementById(id);
                if (!cur || !next) return false;
                cur.innerHTML = next.innerHTML;
                return true;
            };
            const ids = ['liveViewSummary', 'innings-players', 'innings-team1', 'innings-team2'];
            if (!ids.every(swap)) return false;
            window.MATCH = freshMatch;
            document.dispatchEvent(new CustomEvent('match:updated', { detail: freshMatch }));
            return true;
        } catch (e) {
            return false;
        }
    }

    async function checkForUpdate() {
        if (!isTabVisible || isChecking) return; // save battery/data when backgrounded
        isChecking = true;
        try {
            const res = await fetch(`/turfs/live/${match._id}${location.search}`, {
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) return;
            const data = await res.json();
            const freshUpdatedAt = data.match?.updatedAt;
            if (freshUpdatedAt && freshUpdatedAt !== lastUpdatedAt) {
                lastUpdatedAt = freshUpdatedAt;
                const ok = await softRefresh(data.match);
                if (!ok) window.location.reload(); // fallback to the old behaviour
            }
        } catch (err) {
            // Silently ignore — next poll will just try again. No need to
            // alarm a view-only visitor over a transient network hiccup.
        } finally {
            isChecking = false;
        }
    }

    setInterval(checkForUpdate, POLL_INTERVAL_MS);
});