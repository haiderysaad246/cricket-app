document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('deletePlayerOverlay');
    if (!overlay) return; // not on the /players page

    const form = document.getElementById('deletePlayerForm');
    const nameEl = document.getElementById('deletePlayerName');
    const cancelBtn = document.getElementById('cancelDeletePlayer');

    document.querySelectorAll('.delete-item').forEach((btn) => {
        btn.addEventListener('click', () => {
            form.action = '/players/' + btn.dataset.deleteId + '/delete';
            nameEl.textContent = btn.dataset.deleteName;
            overlay.style.display = 'flex';
        });
    });

    cancelBtn.addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
});