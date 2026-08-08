document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.scorecard-tab');
    if (!tabs.length) return; // not on the live match page

    const match = window.MATCH;
    const matchId = match._id;

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            tabs.forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.scorecard-innings').forEach((panel) => {
                panel.style.display = 'none';
            });

            const panel = document.getElementById('innings-' + tab.dataset.innings);
            if (panel) panel.style.display = 'block';
        });
    });

    // ---- helpers ----
    const currentTeam = () => match[match.currentInnings];

    async function postJson(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            alert('Something went wrong: ' + (data.error || 'unknown error'));
            throw new Error(data.error || 'request_failed');
        }
        return data;
    }

    function refresh() {
        window.location.reload();
    }

    function findPlayer(list, id) {
        return list.find((p) => String(p.id) === String(id));
    }

    // ---- Shared single-select card picker ----
    const cardPickerOverlay = document.getElementById('cardPickerOverlay');
    const cardPickerGrid = document.getElementById('cardPickerGrid');
    const cardPickerTitle = document.getElementById('cardPickerTitle');
    let cardPickerSelectedId = null;
    let cardPickerCallback = null;

    function openCardPicker(players, title, currentId, callback) {
        cardPickerTitle.textContent = title;
        cardPickerSelectedId = currentId ? String(currentId) : null;
        cardPickerCallback = callback;

        cardPickerGrid.innerHTML = players.map((p) => `
            <div class="player-card picker-player-card${String(p.id) === cardPickerSelectedId ? ' picker-selected' : ''}" data-id="${p.id}">
                <div class="player-card-link">
                    <div class="player-pic-ring">
                        <img src="${p.image}" alt="${p.name}" class="player-pic" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';">
                    </div>
                    <div class="player-info">
                        <span class="player-name">${p.name}</span>
                    </div>
                </div>
                <i class="fa-solid fa-circle-check picker-check-icon"></i>
            </div>
        `).join('');

        cardPickerGrid.querySelectorAll('.picker-player-card').forEach((card) => {
            card.addEventListener('click', () => {
                cardPickerGrid.querySelectorAll('.picker-player-card').forEach((c) => c.classList.remove('picker-selected'));
                card.classList.add('picker-selected');
                cardPickerSelectedId = card.dataset.id;
            });
        });

        cardPickerOverlay.style.display = 'flex';
    }

    document.getElementById('cancelCardPicker').addEventListener('click', () => {
        cardPickerOverlay.style.display = 'none';
    });

    document.getElementById('confirmCardPicker').addEventListener('click', () => {
        if (!cardPickerSelectedId) {
            alert('Please select a player.');
            return;
        }
        cardPickerOverlay.style.display = 'none';
        if (cardPickerCallback) cardPickerCallback(cardPickerSelectedId);
    });

    function chipHtml(player) {
        if (!player) return '';
        return `<span class="picked-player-chip"><img src="${player.image}" alt="${player.name}" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';"><span>${player.name}</span></span>`;
    }

    // Player pools per role. Batting-side roles draw only from that
    // innings' batting list; bowling-side roles (bowler/keeper) draw only
    // from that innings' bowling list (the fielding team) — never mixed.
    // Bowler and keeper mutually exclude each other's current pick, same
    // for striker/non-striker.
    function poolForRole(role) {
        const t = currentTeam();
        switch (role) {
            case 'striker':
                return t.batting.filter((p) => p.status !== 'out' && p.status !== 'retired' && String(p.id) !== String(roleValues.nonStriker || ''));
            case 'nonStriker':
                return t.batting.filter((p) => p.status !== 'out' && p.status !== 'retired' && String(p.id) !== String(roleValues.striker || ''));
            case 'bowler':
                return t.bowling.filter((p) => String(p.id) !== String(roleValues.keeper || ''));
            case 'keeper':
                return t.bowling.filter((p) => String(p.id) !== String(roleValues.bowler || ''));
            default:
                return [];
        }
    }

    const roleTitles = {
        striker: 'Select Striker',
        nonStriker: 'Select Non-Striker',
        bowler: 'Select Bowler',
        keeper: 'Select Wicketkeeper',
    };

    // roleValues holds the currently chosen player id per role button,
    // separate from window.MATCH so unsaved picks don't leak into state.
    const roleValues = {};

    document.querySelectorAll('.role-pick-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const role = btn.dataset.role;
            const pool = poolForRole(role);
            const currentId = roleValues[role] || null;
            openCardPicker(pool, roleTitles[role] || 'Select Player', currentId, (id) => {
                roleValues[role] = id;
                const player = findPlayer(pool, id);
                const chipEl = document.getElementById('picked' + role.charAt(0).toUpperCase() + role.slice(1));
                if (chipEl) chipEl.innerHTML = chipHtml(player);
            });
        });
    });

    function resetRoleChip(role) {
        delete roleValues[role];
        const chipEl = document.getElementById('picked' + role.charAt(0).toUpperCase() + role.slice(1));
        if (chipEl) chipEl.innerHTML = '';
    }

    // ---- toolbar visibility ----
    const startBtn = document.getElementById('startInningsBtn');
    const scoreBallBtn = document.getElementById('scoreBallBtn');

    const team = currentTeam();
    const isFullySetUp = !!(team.strikerId && team.nonStrikerId && team.currentBowlerId && team.keeperId);
    if (startBtn && isFullySetUp) {
        startBtn.style.display = 'none';
        if (scoreBallBtn) scoreBallBtn.style.display = '';
    }

    // ---- Innings setup modal ----

    const setupOverlay = document.getElementById('inningsSetupOverlay');
    const setupForm = document.getElementById('inningsSetupForm');
    const initialSetupFields = document.getElementById('initialSetupFields');
    let setupMode = 'initial'; // 'initial' (all 4 fields) or 'keeper' (keeper only)

    function openSetupModal(mode) {
        setupMode = mode;
        const t = currentTeam();

        if (mode === 'initial') {
            initialSetupFields.style.display = '';
            ['striker', 'nonStriker', 'bowler', 'keeper'].forEach((role) => resetRoleChip(role));
            const prefill = { striker: t.strikerId, nonStriker: t.nonStrikerId, bowler: t.currentBowlerId, keeper: t.keeperId };
            Object.keys(prefill).forEach((role) => {
                if (!prefill[role]) return;
                const pool = poolForRole(role);
                const player = findPlayer(pool, prefill[role]);
                if (player) {
                    roleValues[role] = String(prefill[role]);
                    const chipEl = document.getElementById('picked' + role.charAt(0).toUpperCase() + role.slice(1));
                    if (chipEl) chipEl.innerHTML = chipHtml(player);
                }
            });
        } else {
            // Keeper-only: striker/non-striker/bowler change through the
            // ball-by-ball flow later, not here.
            initialSetupFields.style.display = 'none';
            resetRoleChip('keeper');
            if (t.keeperId) {
                const pool = poolForRole('keeper');
                const player = findPlayer(pool, t.keeperId);
                if (player) {
                    roleValues.keeper = String(t.keeperId);
                    document.getElementById('pickedKeeper').innerHTML = chipHtml(player);
                }
            }
        }

        setupOverlay.style.display = 'flex';
    }

    if (startBtn) {
        startBtn.addEventListener('click', () => openSetupModal('initial'));
        document.querySelectorAll('#cancelInningsSetup, #closeInningsSetup').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (setupOverlay) setupOverlay.style.display = 'none';
            });
        });

        // The setup form pops up immediately after a fresh match is created,
        // so the user isn't left staring at an empty scorecard.
        if (!isFullySetUp) {
            openSetupModal('initial');
        }

        if (setupForm) {
            setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (setupMode === 'initial') {
            const strikerId = roleValues.striker;
            const nonStrikerId = roleValues.nonStriker;
            const bowlerId = roleValues.bowler;
            const keeperId = roleValues.keeper;

            if (!strikerId || !nonStrikerId || !bowlerId || !keeperId) {
                alert('Please select all four players.');
                return;
            }
            if (strikerId === nonStrikerId) {
                alert('Striker and non-striker must be different players.');
                return;
            }
            if (bowlerId === keeperId) {
                alert('Bowler and wicketkeeper must be different players.');
                return;
            }

            await postJson(`/turfs/live/${matchId}/setup`, {
                innings: match.currentInnings,
                strikerId,
                nonStrikerId,
                bowlerId,
                keeperId,
            });
            // All four roles just got set — go straight into scoring
            // instead of leaving the user to find the "Score Ball" button.
            window.location.href = `/turfs/live/${matchId}/score`;
            return;
        } else {
            const keeperId = roleValues.keeper;
            if (!keeperId) {
                alert('Please select a wicketkeeper.');
                return;
            }
            await postJson(`/turfs/live/${matchId}/setup`, {
                innings: match.currentInnings,
                keeperId,
            });
        }

        refresh();
            });
        }
    }

    // Resume: takes the user to the dedicated full-page scorer instead of
    // opening a modal, so the whole scorecard + input pad both get room.
    if (scoreBallBtn) {
        scoreBallBtn.addEventListener('click', () => {
            window.location.href = `/turfs/live/${matchId}/score`;
        });
    }
});