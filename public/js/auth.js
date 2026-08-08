document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('loginToggleBtn');
    const popover = document.getElementById('loginPopover');
    const errorEl = document.getElementById('loginError');
    const logoutBtn = document.getElementById('logoutBtn');

    if (toggleBtn && popover) {
        toggleBtn.addEventListener('click', () => {
            popover.classList.toggle('open');
            if (popover.classList.contains('open')) document.getElementById('loginPassword').focus();
        });

        document.addEventListener('click', (e) => {
            if (!popover.contains(e.target) && e.target !== toggleBtn) popover.classList.remove('open');
        });

        popover.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorEl.textContent = '';
            const password = document.getElementById('loginPassword').value;
            try {
                const res = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    errorEl.textContent = data.error || 'Login failed';
                    return;
                }
                window.location.reload();
            } catch {
                errorEl.textContent = 'Something went wrong';
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await fetch('/logout', { method: 'POST' }).catch(() => {});
            window.location.reload();
        });
    }
});
