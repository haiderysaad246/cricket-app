document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('form[data-sync-pending-scores]').forEach((form) => {
        let syncing = false;

        form.addEventListener('submit', async (event) => {
            if (form.dataset.syncComplete === 'true') return;
            const confirmation = form.dataset.confirm;
            if (confirmation && !window.confirm(confirmation)) {
                event.preventDefault();
                return;
            }
            event.preventDefault();
            if (syncing) return;
            syncing = true;

            const button = form.querySelector('button[type="submit"]');
            let status = document.getElementById('offlineSyncStatus');
            if (!status) {
                status = document.createElement('p');
                status.id = 'offlineSyncStatus';
                status.setAttribute('role', 'status');
                status.setAttribute('aria-live', 'polite');
                form.insertAdjacentElement('afterend', status);
            }
            if (button) button.disabled = true;

            try {
                if (!navigator.onLine) {
                    throw new Error('You are offline. Scores remain saved on this device; reconnect and click again.');
                }
                const pending = await window.OfflineStore.getPendingBalls();
                for (let index = 0; index < pending.length; index++) {
                    const operation = pending[index];
                    status.textContent = `Syncing saved scores (${index + 1} of ${pending.length})…`;
                    const response = await fetch(operation.url, {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(operation.body),
                    });
                    const result = await response.json();
                    if (!response.ok || !result.ok || !result.match) {
                        throw new Error(result.error || `Could not sync a score (HTTP ${response.status}).`);
                    }
                    await window.OfflineStore.saveSyncedMatch(operation.operationId, result.match);
                }
                status.textContent = 'Saved scores synced. Continuing…';
                form.dataset.syncComplete = 'true';
                form.submit();
            } catch (error) {
                console.error('manual_score_sync_failed', error);
                status.textContent = `Sync stopped: ${error.message} Remaining unsynced scores are kept on this device.`;
                if (button) button.disabled = false;
                syncing = false;
            }
        });
    });
});
