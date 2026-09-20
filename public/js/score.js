document.addEventListener('DOMContentLoaded', () => {
    let match = window.MATCH;
    if (!match) return; // not on the score page
    const matchId = match._id;
    let team = match[match.currentInnings];
    let isSubmitting = false;

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

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Preserve populated logo objects if the server returns raw ObjectIds
    function preserveTeamLogos(newMatch, oldMatch) {
        if (!newMatch) return;
        const t1Logo = (newMatch.team1TeamId && typeof newMatch.team1TeamId === 'object' && newMatch.team1TeamId.logo)
            || (oldMatch && oldMatch.team1TeamId && typeof oldMatch.team1TeamId === 'object' && oldMatch.team1TeamId.logo)
            || null;
        const t2Logo = (newMatch.team2TeamId && typeof newMatch.team2TeamId === 'object' && newMatch.team2TeamId.logo)
            || (oldMatch && oldMatch.team2TeamId && typeof oldMatch.team2TeamId === 'object' && oldMatch.team2TeamId.logo)
            || null;
        if (t1Logo) newMatch.team1TeamId = { logo: t1Logo };
        if (t2Logo) newMatch.team2TeamId = { logo: t2Logo };
    }

    function renderLiveScoreSummary(m) {
        const oversDisplayTop = (balls) => Math.floor((balls || 0) / 6) + '.' + ((balls || 0) % 6);
        const leftKey = m.currentInnings;
        const rightKey = leftKey === 'team1' ? 'team2' : 'team1';
        const leftTeam = m[leftKey] || {};
        const rightTeam = m[rightKey] || {};
        const leftTeamLogo = (leftKey === 'team1' ? m.team1TeamId : m.team2TeamId)?.logo || '/images/placeholder-player.svg';
        const rightTeamLogo = (rightKey === 'team1' ? m.team1TeamId : m.team2TeamId)?.logo || '/images/placeholder-player.svg';
        const rightTeamDone = rightKey === m.battingFirst && m.currentInnings !== m.battingFirst;

        const liveTeam = m[m.currentInnings] || {};
        const liveStriker = (liveTeam.batting || []).find((p) => String(p.id) === String(liveTeam.strikerId));
        const liveNonStriker = (liveTeam.batting || []).find((p) => String(p.id) === String(liveTeam.nonStrikerId));
        const liveBowler = (liveTeam.bowling || []).find((p) => String(p.id) === String(liveTeam.currentBowlerId));
        const liveExtras = (liveTeam.extraWides || 0) + (liveTeam.extraNoBalls || 0);
        const liveSecondKey = m.battingFirst === 'team1' ? 'team2' : 'team1';
        const liveTarget = m.currentInnings === liveSecondKey ? ((m[m.battingFirst]?.totalRuns || 0) + 1) : null;

        const ballChipClass = (b) => {
            if (b === 'W' || b.endsWith('W')) return 'over-ball-wicket';
            if (b.startsWith('wd') || b.startsWith('nb')) return 'over-ball-extra';
            if (b === '4' || b === '6') return 'over-ball-boundary';
            return 'over-ball-normal';
        };
        const ballRuns = (b) => {
            if (b === 'W') return 0;
            const runoutMatch = b.match(/^(\d+)W$/);
            if (runoutMatch) return Number(runoutMatch[1]);
            if (b.startsWith('wd')) { const matchWd = b.match(/^wd\+(\d+)/); return 1 + (matchWd ? Number(matchWd[1]) : 0); }
            if (b.startsWith('nb')) { const matchNb = b.match(/^nb\+(\d+)/); return 1 + (matchNb ? Number(matchNb[1]) : 0); }
            const n = Number(b);
            return isNaN(n) ? 0 : n;
        };
        const liveOverRuns = (liveTeam.currentOverBalls || []).reduce((sum, b) => sum + ballRuns(b), 0);

        let inplayHtml = '';
        if (liveBowler || liveStriker || liveNonStriker) {
            const battingIds = (liveTeam.batting || []).map((p) => String(p.id));
            const activeBatters = [liveStriker, liveNonStriker]
                .filter(Boolean)
                .sort((a, b) => battingIds.indexOf(String(a.id)) - battingIds.indexOf(String(b.id)));

            const battersHtml = activeBatters.map((batter) => {
                const isOnStrike = String(batter.id) === String(liveTeam.strikerId);
                return `
                    <div class="live-player-line">
                        <span class="on-strike-dot${isOnStrike ? ' is-active' : ''}"></span>
                        <span class="live-player-name">${escapeHtml(batter.name)} <i class="fa-solid fa-cricket-bat-ball" style="${isOnStrike ? '' : 'visibility:hidden;'}"></i></span>
                        <span class="live-player-stat">${batter.runs || 0}/${batter.balls || 0}</span>
                    </div>
                `;
            }).join('');

            const bowlerHtml = liveBowler ? `
                <div class="live-player-line">
                    <span class="live-player-name">${escapeHtml(liveBowler.name)}</span>
                    <span class="live-player-stat">${liveBowler.runs || 0}/${liveBowler.wickets || 0}</span>
                </div>
            ` : '';

            const overBallsHtml = (liveTeam.currentOverBalls || []).map((b) => `
                <span class="over-ball-chip ${ballChipClass(b)}">${escapeHtml(b)}</span>
            `).join('');

            const overEmptyHtml = !(liveTeam.currentOverBalls || []).length ? `
                <span class="live-over-empty">Over not started</span>
            ` : '';

            const overTotalHtml = (liveTeam.currentOverBalls || []).length ? `
                <div class="live-over-total">This over: ${liveOverRuns} run${liveOverRuns === 1 ? '' : 's'}</div>
            ` : '';

            let targetNeededHtml = '';
            if (liveTarget !== null && !m.result) {
                const liveRunsNeeded = Math.max(liveTarget - (liveTeam.totalRuns || 0), 0);
                const liveBallsLeft = Math.max((m.overs * 6) - (liveTeam.legalBalls || 0), 0);
                targetNeededHtml = `<div class="live-needed-row">Need ${liveRunsNeeded} runs in ${liveBallsLeft} balls</div>`;
            }

            inplayHtml = `
                <div class="live-inplay-grid">
                    <div class="live-batters-col">
                        <div class="live-inplay-heading">Batters</div>
                        ${battersHtml}
                    </div>

                    <div class="live-bowler-col">
                        <div class="live-inplay-heading">Bowler</div>
                        ${bowlerHtml}
                        <div class="live-over-balls">
                            ${overBallsHtml}
                            ${overEmptyHtml}
                        </div>
                        ${overTotalHtml}
                    </div>
                </div>

                ${targetNeededHtml}

                <div class="live-summary-footer">
                    ${liveTarget !== null ? `
                        <div class="live-footer-item">
                            <span class="live-footer-label">Target</span>
                            <span class="live-footer-value">${liveTarget}</span>
                        </div>
                    ` : ''}
                    <div class="live-footer-item">
                        <span class="live-footer-label">Extras</span>
                        <span class="live-footer-value">${liveExtras} <span class="scorecard-extras-detail">(W ${liveTeam.extraWides || 0}, NB ${liveTeam.extraNoBalls || 0}) = ${liveExtras}</span></span>
                    </div>
                    <div class="live-footer-item live-footer-item-right">
                        <span class="live-footer-label">Total</span>
                        <span class="live-footer-value">${liveTeam.totalRuns || 0}/${liveTeam.wickets || 0}</span>
                    </div>
                </div>
            `;
        }

        const resultBannerHtml = m.result ? `
            <div class="live-result-banner">${escapeHtml(m.result)}</div>
        ` : '';

        return `
            <div class="live-score-card">
                ${resultBannerHtml}
                <div class="live-score-row">
                    <div class="live-score-team">
                        <div class="live-team-badge live-team-badge-a">
                            <img src="${escapeHtml(leftTeamLogo)}" alt="${escapeHtml(leftTeam.name || '')}" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';">
                        </div>
                        <div class="live-team-name">${escapeHtml(leftTeam.name || '')}</div>
                    </div>

                    <div class="live-score-mid">
                        <div class="live-score-value">${leftTeam.totalRuns || 0}/${leftTeam.wickets || 0}</div>
                        <div class="live-score-overs">(${oversDisplayTop(leftTeam.legalBalls || 0)} ov)</div>
                    </div>

                    <div class="live-score-vs">VS</div>

                    <div class="live-score-mid ${rightTeamDone ? 'live-innings-done' : ''}">
                        <div class="live-score-value">${rightTeam.totalRuns || 0}/${rightTeam.wickets || 0}</div>
                        <div class="live-score-overs">(${oversDisplayTop(rightTeam.legalBalls || 0)} ov)</div>
                    </div>

                    <div class="live-score-team ${rightTeamDone ? 'live-innings-done' : ''}">
                        <div class="live-team-badge live-team-badge-b">
                            <img src="${escapeHtml(rightTeamLogo)}" alt="${escapeHtml(rightTeam.name || '')}" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';">
                        </div>
                        <div class="live-team-name">${escapeHtml(rightTeam.name || '')}</div>
                    </div>
                </div>

                ${inplayHtml}
            </div>
        `;
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

    function isInningsOver(t) {
        if (!t) return false;
        const wicketCap = match.isSuperOver ? 2 : (t.batting ? t.batting.length - 1 : 10);
        return t.legalBalls >= match.overs * 6 || t.wickets >= wicketCap || !!t.endedEarly;
    }

    function updateUndoBtn() {
        const undoCount = (match.lastBallSnapshots || []).length;
        scorePadUndoBtn.style.display = undoCount > 0 ? '' : 'none';
        scorePadUndoBtn.title = undoCount > 0 ? `Undo last ball (${undoCount} left)` : 'Undo last ball';
        scorePadUndoBtn.disabled = false;
    }

    function checkOverAndPromptBowler() {
        if (!team) return;
        const storageKey = 'bowlerPrompted_' + matchId + '_' + match.currentInnings;
        if (team.legalBalls > 0 && team.legalBalls % 6 === 0 && !isInningsOver(team)) {
            const lastPromptedBalls = sessionStorage.getItem(storageKey);
            if (String(team.legalBalls) !== lastPromptedBalls) {
                sessionStorage.setItem(storageKey, String(team.legalBalls));
                promptNextBowler();
            }
        } else {
            sessionStorage.removeItem(storageKey);
        }
    }

    function handleMatchUpdate(updatedMatch) {
        if (!updatedMatch) return;
        if (redirectToSessionIfDone(updatedMatch)) return;

        preserveTeamLogos(updatedMatch, match);
        match = updatedMatch;
        window.MATCH = match;
        team = match[match.currentInnings];

        const isSetUp = !!(team && team.strikerId && team.nonStrikerId && team.currentBowlerId);
        if (!isSetUp || isInningsOver(team)) {
            window.location.href = `/turfs/live/${matchId}`;
            return;
        }

        const wrapper = document.getElementById('liveScoreSummaryWrapper');
        if (wrapper) {
            wrapper.innerHTML = renderLiveScoreSummary(match);
        }

        updateUndoBtn();
        updateEditablePlayers();
        abortInput();
        checkOverAndPromptBowler();
    }

    function findRow(list, id) {
        return (list || []).find((p) => String(p.id) === String(id));
    }

    // Every leaf tap submits immediately — no separate Done step. This is
    // used directly for runs/dot/wide/no-ball (the branches with no
    // further "who/what" questions attached to them).
    async function submitDirect(body) {
        if (isSubmitting) return;
        isSubmitting = true;
        scorePadGrid.style.pointerEvents = 'none';
        try {
            const data = await postJson(`/turfs/live/${matchId}/ball`, {
                innings: match.currentInnings,
                ...body,
            });
            handleMatchUpdate(data.match);
        } catch (err) {
            console.error(err);
        } finally {
            isSubmitting = false;
            scorePadGrid.style.pointerEvents = '';
        }
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

    function pickStumper(callback) {
        const pool = team.bowling.filter((p) => String(p.id) !== String(team.currentBowlerId));
        openCardPicker(pool, 'Who Stumped It?', (id) => {
            fielderId = id;
            callback();
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
        if (isSubmitting) return;
        isSubmitting = true;
        scorePadGrid.style.pointerEvents = 'none';
        try {
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
                    fielderId: outType === 'stumping' ? fielderId : undefined,
                    isWide: outType === 'stumping' ? isWideStumping : undefined,
                });
            }
            handleMatchUpdate(data.match);
        } catch (err) {
            console.error(err);
        } finally {
            isSubmitting = false;
            scorePadGrid.style.pointerEvents = '';
        }
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
                <button type="button" class="score-pad-btn" data-action="morerun">4+ (Running)</button>
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
            scorePadGrid.innerHTML = [4, 5, 6, 7, 8, 9, 10].map((n) => `
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
                    } else if (outType === 'stumping') {
                        pickStumper(() => pickNewBatsman(() => submitBall(), !isWideStumping));
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
    // only keeps a snapshot stack, so this can go back up to 3 balls.
    async function doUndo() {
        if (isSubmitting) return;
        isSubmitting = true;
        scorePadUndoBtn.disabled = true;
        try {
            const data = await postJson(`/turfs/live/${matchId}/undo`, {});
            sessionStorage.removeItem('bowlerPrompted_' + matchId + '_' + match.currentInnings);
            sessionStorage.removeItem('bowlerPrompted_' + matchId + '_' + data.match.currentInnings);
            handleMatchUpdate(data.match); // redraws in place, also when it goes back to the previous innings
        } catch (err) {
            scorePadUndoBtn.disabled = false;
        } finally {
            isSubmitting = false;
        }
    }
    scorePadUndoBtn.addEventListener('click', doUndo);

    // Tap the bowler's line to change the bowler, even mid-over.
    document.getElementById('liveScoreSummaryWrapper').addEventListener('click', (e) => {
        if (!e.target.closest('.live-bowler-col .live-player-line') || isSubmitting) return;
        const pool = team.bowling.filter((p) => String(p.id) !== String(team.currentBowlerId));
        openCardPicker(pool, 'Change Bowler', async (id) => {
            try {
                const data = await postJson(`/turfs/live/${matchId}/setup`, {
                    innings: match.currentInnings,
                    bowlerId: id,
                });
                handleMatchUpdate(data.match);
            } catch (err) {
                console.error(err);
            }
        });
    });

    // ---- Change players before the first ball --------------------------
    function ballsStarted(t) {
        return !!t && ((t.legalBalls || 0) > 0 || (t.totalRuns || 0) > 0 || (t.wickets || 0) > 0 || (t.currentOverBalls || []).length > 0);
    }
    function updateEditablePlayers() {
        document.getElementById('liveScoreSummaryWrapper').classList.toggle('can-edit-players', !ballsStarted(team));
    }

    const scoreSetupOverlay = document.getElementById('scoreSetupOverlay');
    const setupPicks = {};
    const setupChipIds = { striker: 'spStriker', nonStriker: 'spNonStriker', bowler: 'spBowler' };
    const setupTitles = { striker: 'Select Striker', nonStriker: 'Select Non-Striker', bowler: 'Select Bowler' };

    function setupPool(role) {
        const notOut = (p) => p.status !== 'out' && p.status !== 'retired';
        if (role === 'striker') return team.batting.filter((p) => notOut(p) && String(p.id) !== String(setupPicks.nonStriker || ''));
        if (role === 'nonStriker') return team.batting.filter((p) => notOut(p) && String(p.id) !== String(setupPicks.striker || ''));
        return team.bowling;
    }
    function showSetupChip(role) {
        const p = findRow(role === 'bowler' ? team.bowling : team.batting, setupPicks[role]);
        document.getElementById(setupChipIds[role]).innerHTML = p
            ? `<span class="picked-player-chip"><img src="${p.image}" alt="${escapeHtml(p.name)}" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';"><span>${escapeHtml(p.name)}</span></span>`
            : '';
    }
    function openSetupForm() {
        setupPicks.striker = team.strikerId;
        setupPicks.nonStriker = team.nonStrikerId;
        setupPicks.bowler = team.currentBowlerId;
        Object.keys(setupChipIds).forEach(showSetupChip);
        scoreSetupOverlay.style.display = 'flex';
    }

    document.getElementById('liveScoreSummaryWrapper').addEventListener('click', (e) => {
        if (e.target.closest('.live-batters-col') && !ballsStarted(team) && !isSubmitting) openSetupForm();
    });
    document.querySelectorAll('#scoreSetupForm .role-pick-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const role = btn.dataset.role;
            openCardPicker(setupPool(role), setupTitles[role], (id) => {
                setupPicks[role] = id;
                showSetupChip(role);
            });
        });
    });
    document.querySelectorAll('#cancelScoreSetup, #closeScoreSetup').forEach((b) => {
        b.addEventListener('click', () => { scoreSetupOverlay.style.display = 'none'; });
    });
    document.getElementById('scoreSetupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!setupPicks.striker || !setupPicks.nonStriker || !setupPicks.bowler) {
            alert('Please select striker, non-striker and bowler.');
            return;
        }
        try {
            const data = await postJson(`/turfs/live/${matchId}/setup`, {
                innings: match.currentInnings,
                strikerId: setupPicks.striker,
                nonStrikerId: setupPicks.nonStriker,
                bowlerId: setupPicks.bowler,
            });
            scoreSetupOverlay.style.display = 'none';
            handleMatchUpdate(data.match);
        } catch (err) {
            console.error(err);
        }
    });

    updateUndoBtn();
    // Click feedback: a button goes lighter as soon as it's tapped, and stays
    // that way briefly even if the pad redraws right after.
    document.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('button, .score-pad-backbar, .ig-picker-item');
        if (!btn || btn.disabled) return;
        btn.classList.add('is-pressed');
        setTimeout(() => btn.classList.remove('is-pressed'), 300);
    });

    updateEditablePlayers();
    renderScorePad();

    function promptNextBowler() {
        const cancelBtn = document.getElementById('cancelCardPicker');
        const closeBtn = cardPickerCloseBtn;
        cancelBtn.style.display = 'none';
        closeBtn.style.display = 'none';
        const pool = team.bowling;
        openCardPicker(pool, "Select Next Over's Bowler", async (id) => {
            try {
                const data = await postJson(`/turfs/live/${matchId}/setup`, {
                    innings: match.currentInnings,
                    bowlerId: id,
                });
                cancelBtn.style.display = '';
                closeBtn.style.display = '';
                handleMatchUpdate(data.match);
            } catch (err) {
                cancelBtn.style.display = '';
                closeBtn.style.display = '';
                console.error(err);
            }
        });
    }

    checkOverAndPromptBowler();
});
