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

    async function checkForUpdate() {
        if (!isTabVisible || isChecking) return; // save battery/data when backgrounded
        isChecking = true;
        try {
            const res = await fetch(`/turfs/live/${match._id}`, {
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) return;
            const data = await res.json();
            const freshUpdatedAt = data.match?.updatedAt;
            if (freshUpdatedAt && freshUpdatedAt !== lastUpdatedAt) {
                // Something changed server-side (a ball was scored, innings
                // switched, etc). Reload to pick up the new state — simplest
                // reliable way to stay in sync with this page's rich markup.
                window.location.reload();
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