document.addEventListener('DOMContentLoaded', () => {
    const match = window.MATCH;
    if (!match) return; // not on the score page
    const matchId = match._id;
    const team = match[match.currentInnings];

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

    // When a match auto-completes (maybeDeclareResult flips status to
    // "completed" during scoring), send the user straight to the right
    // session page instead of reloading the score pad — which would just
    // bounce through a server redirect.
    function redirectToSessionIfDone(m) {
        if (m && m.status === 'completed') {
            if (m.tournamentId) {
                window.location.href = `/tcl/session/${m.tournamentId}`;
            } else if (m.turfId) {
                window.location.href = `/turfs/session/${m.turfId}`;
            } else {
                window.location.href = '/turfs';
            }
            return true;
        }
        return false;
    }

    function findRow(list, id) {
        return (list || []).find((p) => String(p.id) === String(id));
    }

    // Every leaf tap submits immediately — no separate Done step. This is
    // used directly for runs/dot/wide/no-ball (the branches with no
    // further "who/what" questions attached to them).
    async function submitDirect(body) {
        const data = await postJson(`/turfs/live/${matchId}/ball`, {
            innings: match.currentInnings,
            ...body,
        });
        if (redirectToSessionIfDone(data.match)) return;
        refresh();
    }

    const scorePadHeader = document.getElementById('scorePadHeader');
    const scorePadBackBar = document.getElementById('scorePadBackBar');
    const scorePadGrid = document.getElementById('scorePadGrid');
    const scorePadUndoBtn = document.getElementById('scorePadUndoBtn');
    const scorePadCloseBtn = document.getElementById('scorePadCloseBtn');
    const cardPickerCloseBtn = document.getElementById('cardPickerCloseBtn');

    // ---- Shared single-select card picker (this page's own instance) ----
    const cardPickerOverlay = document.getElementById('cardPickerOverlay');
    const cardPickerGrid = document.getElementById('cardPickerGrid');
    const cardPickerTitle = document.getElementById('cardPickerTitle');
    let cardPickerSelectedId = null;
    let cardPickerCallback = null;

    function openCardPicker(players, title, callback) {
        cardPickerTitle.textContent = title;
        cardPickerSelectedId = null;
        cardPickerCallback = callback;

        cardPickerGrid.classList.add('ig-picker-grid');
        cardPickerGrid.innerHTML = players.map((p) => `
            <div class="ig-picker-item" data-id="${p.id}">
                <div class="ig-picker-avatar-ring">
                    <img src="${p.image}" alt="${p.name}" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';">
                    <span class="ig-picker-check"><i class="fa-solid fa-check"></i></span>
                </div>
                <span class="ig-picker-name">${p.name}</span>
            </div>
        `).join('');

        cardPickerGrid.querySelectorAll('.ig-picker-item').forEach((item) => {
            item.addEventListener('click', () => {
                cardPickerGrid.querySelectorAll('.ig-picker-item').forEach((i) => i.classList.remove('ig-picker-selected'));
                item.classList.add('ig-picker-selected');
                cardPickerSelectedId = item.dataset.id;
            });
        });

        cardPickerOverlay.style.display = 'flex';
    }

    // Cancelling a picker just closes the modal and drops back onto
    // whichever score-pad screen was showing underneath it — it does NOT
    // jump all the way back to the main menu, since the picker was opened
    // from a child (or grandchild) node, not from the root.
    document.getElementById('cancelCardPicker').addEventListener('click', () => {
    abortInput();
});

cardPickerCloseBtn.addEventListener('click', () => {
    abortInput();
});

    document.getElementById('confirmCardPicker').addEventListener('click', () => {
        if (!cardPickerSelectedId) {
            alert('Please select a player.');
            return;
        }
        cardPickerOverlay.style.display = 'none';
        const cb = cardPickerCallback;
        cardPickerCallback = null;
        if (cb) cb(cardPickerSelectedId);
    });

    const headerLabels = {
        main: 'Score Ball',
        moreRuns: 'How Many Runs?',
        out: 'Out',
        stumped: 'Stumped',
        noball: 'No Ball',
        runoutRuns: 'Runs Completed',
    };

    // ---- Navigation stack ----------------------------------------------
    // 'main' is the root: the six parent nodes (Runs / Out / Wide /
    // No Ball / Run Out / Dot). Tapping a parent pushes its children onto
    // the stack and they take over the whole score-ball box; Back pops
    // exactly one level, returning to the parent screen. Leaves with no
    // children (Wide, Dot, and every terminal option inside a branch)
    // submit immediately instead of pushing anything.
    let navStack = ['main'];

    function currentLevel() {
        return navStack[navStack.length - 1];
    }

    function pushLevel(level) {
        navStack.push(level);
        renderScorePad();
    }

    function popLevel() {
        if (navStack.length > 1) navStack.pop();
        resetOutState();
        renderScorePad();
    }

    let outType = null;
    let outPlayerId = null;
    let fielderId = null;
    let newBatsmanId = null;
    let runoutRuns = 0;
    let isNoBallRunout = false;
    let isWideStumping = false;

    function resetOutState() {
    outType = null;
    outPlayerId = null;
    fielderId = null;
    newBatsmanId = null;
    runoutRuns = 0;
    isNoBallRunout = false;
    isWideStumping = false;
}

// Full cancel: whatever question/step the user is on (a picker overlay
// or a pushed score-pad level), this drops the whole in-progress entry
// and returns to the root pad. Nothing gets submitted.
function abortInput() {
    cardPickerOverlay.style.display = 'none';
    cardPickerCallback = null;
    navStack = ['main'];
    resetOutState();
    renderScorePad();
}

    function pickFielder(callback) {
        openCardPicker(team.bowling, 'Who Caught It?', (id) => {
            fielderId = id;
            callback();
        });
    }

    const changeKeeperBtn = document.getElementById('changeKeeperBtn');
    if (changeKeeperBtn) {
        changeKeeperBtn.addEventListener('click', () => {
            openCardPicker(team.bowling, 'Select Wicketkeeper', async (id) => {
                await postJson(`/turfs/live/${matchId}/setup`, {
                    innings: match.currentInnings,
                    keeperId: id,
                });
                refresh();
            });
        });
    }

    const endInningsBtn = document.getElementById('endInningsBtn');
    if (endInningsBtn) {
        endInningsBtn.addEventListener('click', async () => {
            if (!confirm('End this innings now with the current score? Use this only when there are no batsmen left to bring in.')) return;
            const data = await postJson(`/turfs/live/${matchId}/end-innings`, {
                innings: match.currentInnings,
            });
            if (redirectToSessionIfDone(data.match)) return;
            window.location.href = `/turfs/live/${matchId}`;
        });
    }

    function pickOutPlayer(callback) {
        const strikerRow = findRow(team.batting, team.strikerId);
        const nonStrikerRow = findRow(team.batting, team.nonStrikerId);
        const pool = [strikerRow, nonStrikerRow].filter(Boolean);
        openCardPicker(pool, 'Who Got Run Out?', (id) => {
            outPlayerId = id;
            callback();
        });
    }

    function pickNewBatsman(callback, isLegalBall) {
        const eligible = team.batting.filter((p) => p.status === 'yet_to_bat');
        // Either no one's left in the squad (all out), or this wicket is
        // itself the last legal ball of the overs — either way the
        // innings is over and there's no new batsman to pick.
        const inningsEndingBall = isLegalBall && (team.legalBalls + 1) >= (match.overs * 6);
        if (eligible.length === 0 || inningsEndingBall) {
            newBatsmanId = null;
            if (callback) callback();
            return;
        }
        openCardPicker(eligible, 'New Batsman', (id) => {
            newBatsmanId = id;
            if (callback) callback();
        });
    }

    // Run Out flow — shared by the top-level "Run Out" node and the
    // "No Ball + Run Out" node. Who ran the batter out -> who got run
    // out -> (pushed) Runs Completed -> who's the new batsman -> submit.
    function startRunoutFlow(isNoBall) {
        resetOutState();
        outType = 'runout';
        isNoBallRunout = isNoBall;
        openCardPicker(team.bowling, 'Who Ran Out the Batter?', (id) => {
            fielderId = id;
            pickOutPlayer(() => {
                pushLevel('runoutRuns');
            });
        });
    }

    // Handles every dismissal that needs more than one piece of info
    // (catch/bowled/hitwicket/stumping/retired/obstructing/runout).
    // Runs/dot/wide/no-ball never reach this — they submit via submitDirect.
    async function submitBall() {
        let data;
        if (outType === 'runout') {
            data = await postJson(`/turfs/live/${matchId}/ball`, {
                innings: match.currentInnings,
                type: 'out',
                outType: 'runout',
                outPlayerId,
                fielderId,
                newBatsmanId,
                runoutRuns,
                isNoBall: isNoBallRunout,
            });
        } else if (outType === 'retired') {
            data = await postJson(`/turfs/live/${matchId}/ball`, {
                innings: match.currentInnings,
                type: 'retire',
                outPlayerId,
                newBatsmanId,
            });
        } else if (outType === 'catch') {
            data = await postJson(`/turfs/live/${matchId}/ball`, {
                innings: match.currentInnings,
                type: 'out',
                outType: 'catch',
                fielderId,
                newBatsmanId,
            });
        } else if (outType === 'obstructing') {
            data = await postJson(`/turfs/live/${matchId}/ball`, {
                innings: match.currentInnings,
                type: 'out',
                outType: 'obstructing',
                outPlayerId,
                newBatsmanId,
            });
        } else {
            // bowled / hitwicket / stumping (stumping can optionally be
            // off a wide — penalty run, ball doesn't count as legal)
            data = await postJson(`/turfs/live/${matchId}/ball`, {
                innings: match.currentInnings,
                type: 'out',
                outType,
                newBatsmanId,
                isWide: outType === 'stumping' ? isWideStumping : undefined,
            });
        }
        if (redirectToSessionIfDone(data.match)) return;
        refresh();
    }

    function renderScorePad() {
        const level = currentLevel();
        scorePadHeader.textContent = headerLabels[level] || 'Score Ball';
scorePadBackBar.style.display = level === 'main' ? 'none' : 'flex';
scorePadCloseBtn.style.display = level === 'main' ? 'none' : 'flex';
        

        if (level === 'main') {
            // ---- Root: runs are direct leaves now (classic pad layout).
            // Only Out / No Ball push a child level; Wide submits
            // immediately; Run Out opens its picker chain straight away;
            // "5, 7+" opens a small follow-up asking the exact run count
            // for anything above the standard buttons. ----
            scorePadGrid.innerHTML = `
                <button type="button" class="score-pad-btn" data-run="dot">0</button>
                <button type="button" class="score-pad-btn" data-run="one">1</button>
                <button type="button" class="score-pad-btn" data-run="two">2</button>
                <button type="button" class="score-pad-btn" data-run="three">3</button>
                <button type="button" class="score-pad-btn" data-run="four">4 (Four)</button>
                <button type="button" class="score-pad-btn" data-run="six">6 (Six)</button>
                <button type="button" class="score-pad-btn" data-action="morerun">5, 6, 7+</button>
                <button type="button" class="score-pad-btn" data-run="one_nr">1 (No Rotation)</button>

                <button type="button" class="score-pad-btn score-pad-btn-parent" data-parent="out">
                    <i class="fa-solid fa-xmark"></i>
                    <span>Out</span>
                </button>
                <button type="button" class="score-pad-btn score-pad-btn-parent" data-parent="wide">
                    <i class="fa-solid fa-arrows-left-right"></i>
                    <span>Wide</span>
                </button>
                <button type="button" class="score-pad-btn score-pad-btn-parent" data-parent="noball">
                    <i class="fa-solid fa-shoe-prints"></i>
                    <span>No Ball</span>
                </button>
                <button type="button" class="score-pad-btn score-pad-btn-parent" data-parent="runout">
                    <i class="fa-solid fa-bolt"></i>
                    <span>Run Out</span>
                </button>
            `;
        } else if (level === 'moreRuns') {
            scorePadGrid.innerHTML = [5, 6, 7, 8, 9, 10].map((n) => `
                <button type="button" class="score-pad-btn" data-morerun="${n}">${n} runs</button>
            `).join('');
        } else if (level === 'out') {
            scorePadGrid.innerHTML = `
                <button type="button" class="score-pad-btn" data-dismissal="bowled">Bowled</button>
                <button type="button" class="score-pad-btn" data-dismissal="catch">Caught</button>
                <button type="button" class="score-pad-btn" data-action="stumpedmore">Stumped</button>
                <button type="button" class="score-pad-btn" data-dismissal="hitwicket">Hit Wicket</button>
                <button type="button" class="score-pad-btn" data-dismissal="retired">Retired Out</button>
                <button type="button" class="score-pad-btn" data-dismissal="obstructing">Obstructing the Field</button>
            `;
        } else if (level === 'stumped') {
            scorePadGrid.innerHTML = `
                <button type="button" class="score-pad-btn" data-dismissal="stumping">Stumped</button>
                <button type="button" class="score-pad-btn" data-dismissal="stumping" data-wide-stump="1">Stumped + Wide</button>
            `;
        } else if (level === 'noball') {
            scorePadGrid.innerHTML = `
                <button type="button" class="score-pad-btn" data-nb="dot">No Ball +0</button>
                <button type="button" class="score-pad-btn" data-nb="one">No Ball +1</button>
                <button type="button" class="score-pad-btn" data-nb="two">No Ball +2</button>
                <button type="button" class="score-pad-btn" data-nb="three">No Ball +3</button>
                <button type="button" class="score-pad-btn" data-nb="four_run">No Ball +4</button>
                <button type="button" class="score-pad-btn" data-nb="five">No Ball +5</button>
                <button type="button" class="score-pad-btn" data-nb="four">No Ball + Four</button>
                <button type="button" class="score-pad-btn" data-nb="six">No Ball + Six</button>
                <button type="button" class="score-pad-btn" data-action="nbrunout">No Ball + Run Out</button>
            `;
        } else if (level === 'runoutRuns') {
            scorePadGrid.innerHTML = [0, 1, 2, 3, 4, 5].map((n) => `
                <button type="button" class="score-pad-btn" data-runoutruns="${n}">${n} run${n === 1 ? '' : 's'}</button>
            `).join('');
        }

        scorePadGrid.querySelectorAll('.score-pad-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                // ---- root: parent nodes ----
                // ---- root: parent nodes (Out / No Ball push a level,
                // Wide submits immediately, Run Out opens its picker
                // chain straight away) ----
                if (btn.dataset.parent) {
                    const parent = btn.dataset.parent;
                    if (parent === 'wide') {
                        submitDirect({ type: 'wide' });
                    } else if (parent === 'runout') {
                        startRunoutFlow(false);
                    } else {
                        // out / noball — have children
                        pushLevel(parent);
                    }
                    return;
                }

                // ---- runs: direct leaves on the root grid, submit straight away ----
                if (btn.dataset.run) {
                    submitDirect({ type: btn.dataset.run });
                    return;
                }

                // ---- "5, 7+" opens the exact-runs follow-up ----
                if (btn.dataset.action === 'morerun') {
                    pushLevel('moreRuns');
                    return;
                }

                // ---- exact-runs follow-up: submits straight away ----
                if (btn.dataset.morerun !== undefined) {
                    submitDirect({ type: 'runs_extra', runs: Number(btn.dataset.morerun) });
                    return;
                }

                // ---- out: dismissals that need extra info chain pickers,
                // the rest go straight to "who's the new batsman" ----
                if (btn.dataset.dismissal) {
                    resetOutState();
                    outType = btn.dataset.dismissal;
                    isWideStumping = outType === 'stumping' && btn.dataset.wideStump === '1';
                    if (outType === 'catch') {
                        pickFielder(() => pickNewBatsman(() => submitBall(), true));
                    } else if (outType === 'retired') {
                        // Retire never consumes a ball, so it can only end
                        // the innings via all-out, never via overs.
                        outPlayerId = team.strikerId;
                        pickNewBatsman(() => submitBall(), false);
                    } else if (outType === 'obstructing') {
                        // Always the striker — no picker needed for who.
                        outPlayerId = team.strikerId;
                        pickNewBatsman(() => submitBall(), true);
                    } else {
                        // bowled / stumping / hitwicket — always the
                        // striker. A wide-stumping isn't a legal ball.
                        pickNewBatsman(() => submitBall(), !isWideStumping);
                    }
                    return;
                }

                if (btn.dataset.action === 'stumpedmore') {
                    pushLevel('stumped');
                    return;
                }

                // ---- no ball: runs + boundaries submit straight away ----
                if (btn.dataset.nb) {
                    const nbMap = { dot: 0, one: 1, two: 2, three: 3, four_run: 4, five: 5, four: 4, six: 6 };
                    const nb = btn.dataset.nb;
                    submitDirect({
                        type: 'noball',
                        noballRuns: nbMap[nb],
                        noballBoundary: nb === 'four' ? 'four' : (nb === 'six' ? 'six' : null),
                    });
                    return;
                }

                if (btn.dataset.action === 'nbrunout') {
                    startRunoutFlow(true);
                    return;
                }

                // ---- run-out runs-completed sub-screen ----
                if (btn.dataset.runoutruns !== undefined) {
                    runoutRuns = Number(btn.dataset.runoutruns);
                    // A run-out off a no ball isn't a legal delivery.
                    pickNewBatsman(() => submitBall(), !isNoBallRunout);
                }
            });
        });
    }

    // Back: pops exactly one level, returning to the parent node's UI
    // without saving anything, and drops any in-progress dismissal state.
    scorePadBackBar.addEventListener('click', () => {
        if (currentLevel() === 'main') return;
        popLevel();
    });

    // Close (✕): full cancel from wherever the user is — drops the whole
// in-progress question chain, not just one level, and nothing is sent
// to the server.
scorePadCloseBtn.addEventListener('click', () => {
    abortInput();
});

    // Undo: steps the whole match back by exactly one ball. The backend
    // only keeps a single snapshot (cleared right after it's used), so
    // this can only ever go back one ball, never a second time in a row.
    scorePadUndoBtn.addEventListener('click', async () => {
        if (scorePadUndoBtn.disabled) return;
        scorePadUndoBtn.disabled = true;
        try {
            await postJson(`/turfs/live/${matchId}/undo`, {});
            refresh();
        } catch (err) {
            // Request failed — nothing to reload for, so re-enable it.
            scorePadUndoBtn.disabled = false;
        }
    });

    const undoCount = (match.lastBallSnapshots || []).length;
    scorePadUndoBtn.style.display = undoCount > 0 ? '' : 'none';
    scorePadUndoBtn.title = undoCount > 0 ? `Undo last ball (${undoCount} left)` : 'Undo last ball';
    renderScorePad();

    // ---- Forced "next bowler" prompt at the start of a new over ----
    function isInningsOver(t) {
        return t.legalBalls >= match.overs * 6 || t.wickets >= t.batting.length - 1 || !!t.endedEarly;
    }

    function promptNextBowler() {
        const cancelBtn = document.getElementById('cancelCardPicker');
        const closeBtn = cardPickerCloseBtn;
        cancelBtn.style.display = 'none';
        closeBtn.style.display = 'none';
        const pool = team.bowling.filter((p) => String(p.id) !== String(team.keeperId));
        openCardPicker(pool, "Select Next Over's Bowler", async (id) => {
            await postJson(`/turfs/live/${matchId}/setup`, {
                innings: match.currentInnings,
                bowlerId: id,
            });
            cancelBtn.style.display = '';
            closeBtn.style.display = '';
            refresh();
        });
    }

    if (team.legalBalls > 0 && team.legalBalls % 6 === 0 && !isInningsOver(team)) {
        const storageKey = 'bowlerPrompted_' + matchId + '_' + match.currentInnings;
        const lastPromptedBalls = sessionStorage.getItem(storageKey);
        if (String(team.legalBalls) !== lastPromptedBalls) {
            sessionStorage.setItem(storageKey, String(team.legalBalls));
            promptNextBowler();
        }
    }
});
