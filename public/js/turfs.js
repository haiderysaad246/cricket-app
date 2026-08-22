document.addEventListener('DOMContentLoaded', () => {
    const startMatchBtn = document.getElementById('startMatchBtn');
    if (!startMatchBtn) return; // not on the /turfs page

    const newMatchOverlay = document.getElementById('newMatchOverlay');
    const cancelNewMatch = document.getElementById('cancelNewMatch');
    const newMatchForm = document.getElementById('newMatchForm');

    const playerPickerOverlay = document.getElementById('playerPickerOverlay');
    const pickerTitle = document.getElementById('pickerTitle');
    const pickerGrid = document.getElementById('pickerGrid');
    const cancelPicker = document.getElementById('cancelPicker');
    const donePicker = document.getElementById('donePicker');
    const pickerCards = Array.from(document.querySelectorAll('.picker-player-card'));
    const pickerSearchInput = document.getElementById('pickerSearchInput');

    // Committed selections per team: Map<playerId, { id, name, image }>
    const selections = { team1: new Map(), team2: new Map() };

    // Which player id is captain for each team (double-click a chip to set)
    const captains = { team1: null, team2: null };

    // Working copy while the picker modal is open (Cancel discards this)
    let currentTeam = null;
    let tempSelection = new Map();

    function otherTeamOf(team) {
        return team === 'team1' ? 'team2' : 'team1';
    }

    // Keep the "which team bats first" radio labels showing the actual
    // team names as the admin types them, instead of a generic "Team 1/2".
    function syncBattingFirstLabel(team) {
        const nameInput = document.getElementById(team + 'Name');
        const label = document.getElementById('battingFirstLabel-' + team);
        if (!nameInput || !label) return;
        label.textContent = nameInput.value.trim() || (team === 'team1' ? 'Team 1' : 'Team 2');
    }

    ['team1', 'team2'].forEach((team) => {
        const nameInput = document.getElementById(team + 'Name');
        if (nameInput) nameInput.addEventListener('input', () => syncBattingFirstLabel(team));
    });

    function openNewMatch() {
        newMatchOverlay.style.display = 'flex';
    }

    function closeNewMatch() {
        newMatchOverlay.style.display = 'none';
    }

    function resetForm() {
        newMatchForm.reset();
        selections.team1.clear();
        selections.team2.clear();
        captains.team1 = null;
        captains.team2 = null;
        renderChips('team1');
        renderChips('team2');
        syncBattingFirstLabel('team1');
        syncBattingFirstLabel('team2');
    }

    // If the page provided prefill data (session.ejs's "Change Settings"
    // modal editing an existing turf), load it into the picker state
    // before the modal ever opens — index.ejs's "new turf" form simply
    // won't define window.TURF_PREFILL, so this no-ops there.
    if (window.TURF_PREFILL) {
        const pf = window.TURF_PREFILL;
        ['team1', 'team2'].forEach((team) => {
            (pf[team + 'Players'] || []).forEach((p) => {
                selections[team].set(String(p.id), p);
            });
            if (pf[team + 'Captain']) captains[team] = String(pf[team + 'Captain']);
            renderChips(team);
        });
    }

    startMatchBtn.addEventListener('click', openNewMatch);

    cancelNewMatch.addEventListener('click', () => {
        closeNewMatch();
        resetForm();
    });

    document.querySelectorAll('.team-picker-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            currentTeam = btn.dataset.team;
            tempSelection = new Map(selections[currentTeam]);

            const teamNameInput = document.getElementById(currentTeam + 'Name');
            pickerTitle.textContent = 'Select Players' + (teamNameInput && teamNameInput.value ? ' — ' + teamNameInput.value : '');

            if (pickerSearchInput) pickerSearchInput.value = '';
            renderPickerGrid();
            filterPickerCards('');
            playerPickerOverlay.style.display = 'flex';
        });
    });

    function filterPickerCards(query) {
        const q = query.trim().toLowerCase();
        pickerCards.forEach((card) => {
            const name = (card.dataset.name || '').toLowerCase();
            card.style.display = !q || name.includes(q) ? '' : 'none';
        });
    }

    if (pickerSearchInput) {
        pickerSearchInput.addEventListener('input', () => filterPickerCards(pickerSearchInput.value));
    }

    function renderPickerGrid() {
        const lockedByOtherTeam = selections[otherTeamOf(currentTeam)];

        pickerCards.forEach((card) => {
            const id = card.dataset.id;
            card.classList.remove('picker-selected', 'picker-disabled');

            if (lockedByOtherTeam.has(id)) {
                // Already picked for the other team — can't be picked here
                card.classList.add('picker-disabled');
            } else if (tempSelection.has(id)) {
                card.classList.add('picker-selected');
            }
        });
    }

    pickerGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.picker-player-card');
        if (!card || card.classList.contains('picker-disabled')) return;

        const id = card.dataset.id;
        if (tempSelection.has(id)) {
            tempSelection.delete(id);
            card.classList.remove('picker-selected');
        } else {
            tempSelection.set(id, {
                id,
                name: card.dataset.name,
                image: card.dataset.image,
            });
            card.classList.add('picker-selected');
        }
    });

    cancelPicker.addEventListener('click', () => {
        playerPickerOverlay.style.display = 'none';
        currentTeam = null;
    });

    donePicker.addEventListener('click', () => {
        selections[currentTeam] = new Map(tempSelection);

        // If the previously chosen captain got deselected, drop the captain too
        if (captains[currentTeam] && !selections[currentTeam].has(captains[currentTeam])) {
            captains[currentTeam] = null;
        }

        renderChips(currentTeam);
        playerPickerOverlay.style.display = 'none';
        currentTeam = null;
    });

    function renderChips(team) {
        const chipsWrap = document.getElementById(team + 'Chips');
        const inputsWrap = document.getElementById(team + 'Inputs');
        chipsWrap.innerHTML = '';
        inputsWrap.innerHTML = '';

        selections[team].forEach((player) => {
            const chip = document.createElement('span');
            chip.className = 'turf-player-chip';
            chip.title = 'Tap the photo to make them captain';
            if (captains[team] === player.id) {
                chip.classList.add('is-captain');
            }

            const picWrap = document.createElement('span');
            picWrap.className = 'turf-chip-pic-wrap';

            const img = document.createElement('img');
            img.src = player.image;
            img.alt = player.name;
            img.onerror = function () {
                this.onerror = null;
                this.src = '/images/placeholder-player.svg';
            };
            picWrap.appendChild(img);

            if (captains[team] === player.id) {
                const badge = document.createElement('i');
                badge.className = 'fa-solid fa-crown turf-captain-badge';
                picWrap.appendChild(badge);
            }

            const nameSpan = document.createElement('span');
            nameSpan.textContent = player.name;

            chip.appendChild(picWrap);
            chip.appendChild(nameSpan);

            // Double-click a chip to toggle them as this team's captain
            picWrap.style.cursor = 'pointer';

// Tap the photo to toggle them as this team's captain (single click —
// dblclick doesn't register reliably, especially on touch devices).
picWrap.addEventListener('click', (e) => {
    e.stopPropagation();
    captains[team] = captains[team] === player.id ? null : player.id;
    renderChips(team);
});

            chipsWrap.appendChild(chip);

            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = team + 'Players';
            hiddenInput.value = player.id;
            inputsWrap.appendChild(hiddenInput);
        });

        // Single hidden input carrying the chosen captain's player id (if any)
        const captainInput = document.createElement('input');
        captainInput.type = 'hidden';
        captainInput.name = team + 'Captain';
        captainInput.value = captains[team] || '';
        inputsWrap.appendChild(captainInput);
    }

    newMatchForm.addEventListener('submit', (e) => {
    if (selections.team1.size === 0 || selections.team2.size === 0) {
        e.preventDefault();
        alert('Please select players for both teams before saving the match.');
        return;
    }

    if (!captains.team1 || !captains.team2) {
        e.preventDefault();
        alert('Please select a captain for both teams before saving the match.');
    }
});
});