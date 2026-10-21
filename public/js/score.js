document.addEventListener('DOMContentLoaded', () => {
    let match = window.MATCH;
    if (!match) return; // not on the score page
    const matchId = match._id;
    let team = match[match.currentInnings];
    let isSubmitting = false; // guards non-ball actions (undo, setup, end innings)
    let undoSnapshots = JSON.parse(JSON.stringify(match.lastBallSnapshots || []));
    let redoSnapshots = JSON.parse(JSON.stringify(match.redoBallSnapshots || []));
    let pendingBatches = [];
    let isRestoring = true;
    let uploadPaused = false;
    let scoreBlocked = false;
    let persistenceWarningShown = false;
    let pendingRunout = null;
    let pendingScoring = null;

    // ---- Optimistic scoring queue -----------------------------------
    // Ball taps apply instantly in the browser using the exact same rules
    // as the server (public/js/ballRules.js), and the network request goes
    // out in the background through an ordered chain, so fast taps can
    // never arrive at the server out of order. Undo/setup/end-innings stay
    // as plain round-trips and just wait for this chain to drain first.
    let requestChain = Promise.resolve();
    let unsentBalls = [];
    let ballFlushTimer = null;
    let pendingBalls = 0;
    let pendingHistoryOps = 0; // undo/redo calls still on their way to the server
    let resyncTriggered = false;
    let storageChain = Promise.resolve();
    const activeBatchIds = new Set();
    function isBusy() { return isRestoring || scoreBlocked || isSubmitting || pendingBalls > 0 || pendingHistoryOps > 0; }
    function isActionLocked() { return isRestoring || scoreBlocked || isSubmitting; }
    function needsInternet(label) {
        if (navigator.onLine && !uploadPaused && !scoreBlocked) return false;
        showScoreNotice(`${label} needs an internet connection. Please reconnect and try again.`);
        return true;
    }

    function showScoreNotice(message) {
        let notice = document.querySelector('.score-resync-toast');
        if (!notice) {
            notice = document.createElement('div');
            notice.className = 'score-resync-toast';
            document.body.appendChild(notice);
        }
        notice.textContent = message;
        clearTimeout(notice.dismissTimer);
        notice.dismissTimer = setTimeout(() => notice.remove(), 6000);
    }

    function storageRecord() {
        const savedMatch = JSON.parse(JSON.stringify(match));
        savedMatch.lastBallSnapshots = JSON.parse(JSON.stringify(undoSnapshots));
        savedMatch.redoBallSnapshots = JSON.parse(JSON.stringify(redoSnapshots));
        savedMatch.lastBallSnapshotCount = undoSnapshots.length;
        savedMatch.redoBallSnapshotCount = redoSnapshots.length;
        return {
            matchId: String(matchId),
            match: savedMatch,
            undoSnapshots: JSON.parse(JSON.stringify(undoSnapshots)),
            redoSnapshots: JSON.parse(JSON.stringify(redoSnapshots)),
            pendingBatches: JSON.parse(JSON.stringify(pendingBatches)),
            unsentBalls: JSON.parse(JSON.stringify(unsentBalls)),
            pendingRunout: pendingRunout ? JSON.parse(JSON.stringify(pendingRunout)) : null,
            pendingScoring: pendingScoring ? JSON.parse(JSON.stringify(pendingScoring)) : null,
            savedAt: Date.now(),
        };
    }

    function persistLocalState() {
        if (!window.ScoreStorage) {
            if (!persistenceWarningShown) {
                persistenceWarningShown = true;
                showScoreNotice('Local score recovery is unavailable in this browser. Keep the page open until the score is confirmed.');
            }
            return storageChain;
        }
        const record = storageRecord();
        storageChain = storageChain
            .then(() => window.ScoreStorage.save(record))
            .catch((err) => {
                console.error('score_local_persistence_failed', err);
                if (!persistenceWarningShown) {
                    persistenceWarningShown = true;
                    showScoreNotice('This device could not save a local recovery copy. Keep this page open until the score is confirmed.');
                }
            });
        return storageChain;
    }

    function flushBallQueue() {
        if (ballFlushTimer) {
            clearTimeout(ballFlushTimer);
            ballFlushTimer = null;
        }
        if (!unsentBalls.length) return;
        const batch = {
            batchId: createActionId(),
            actions: unsentBalls.splice(0, 6),
        };
        pendingBatches.push(batch);
        persistLocalState();
        if (!uploadPaused) enqueueBatchUpload(batch);
        if (unsentBalls.length) flushBallQueue();
    }

    function enqueueBatchUpload(batch) {
        if (uploadPaused || activeBatchIds.has(batch.batchId)) return;
        activeBatchIds.add(batch.batchId);
        requestChain = requestChain
            .then(() => storageChain)
            .then(() => uploadPaused ? undefined : sendBallsInBackground(batch))
            .catch((err) => {
                console.error('score_upload_chain_failed', err);
                uploadPaused = true;
                showScoreNotice('Score is saved on this device but not confirmed by the server. Reconnect to retry.');
            })
            .finally(() => {
                activeBatchIds.delete(batch.batchId);
            });
    }

    function createActionId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        const bytes = new Uint8Array(16);
        if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
            window.crypto.getRandomValues(bytes);
            return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    async function restorePendingScore() {
        try {
            if (!window.ScoreStorage) throw new Error('indexeddb_unavailable');
            const saved = await window.ScoreStorage.load(matchId);
            if (saved) {
                const savedBatches = Array.isArray(saved.pendingBatches) ? saved.pendingBatches : [];
                const savedUnsent = Array.isArray(saved.unsentBalls) ? saved.unsentBalls : [];
                if (!saved.match || String(saved.match._id) !== String(matchId)
                    || (saved.undoSnapshots && !Array.isArray(saved.undoSnapshots))
                    || (saved.redoSnapshots && !Array.isArray(saved.redoSnapshots))
                    || (saved.pendingRunout && (!saved.pendingRunout.fielderId
                        || !saved.pendingRunout.outPlayerId
                        || !Number.isInteger(saved.pendingRunout.runoutRuns)))
                    || (saved.pendingScoring && (!saved.pendingScoring.kind
                        || !saved.pendingScoring.body
                        || !['out', 'noball'].includes(saved.pendingScoring.body.type)))
                    || savedBatches.some((batch) => !batch.batchId || !Array.isArray(batch.actions)
                        || batch.actions.some((action) => !action.body || !action.body.clientActionId || !action.predicted))
                    || savedUnsent.some((action) => !action.body || !action.body.clientActionId || !action.predicted)) {
                    throw new Error('indexeddb_score_record_invalid');
                }
                if (!savedBatches.length && !savedUnsent.length) {
                    const cacheMatchesServer = saved.match.updatedAt === match.updatedAt
                        && statesMatch(saved.match, match)
                        && JSON.stringify(saved.undoSnapshots || []) === JSON.stringify(undoSnapshots)
                        && JSON.stringify(saved.redoSnapshots || []) === JSON.stringify(redoSnapshots);
                    if (cacheMatchesServer) {
                        pendingRunout = saved.pendingRunout || null;
                        pendingScoring = saved.pendingScoring || null;
                        renderPendingRunout();
                    } else {
                        pendingRunout = null;
                        pendingScoring = null;
                        await window.ScoreStorage.save(storageRecord());
                    }
                    return;
                }
                match = saved.match;
                pendingRunout = saved.pendingRunout || null;
                pendingScoring = saved.pendingScoring || null;
                undoSnapshots = saved.undoSnapshots || match.lastBallSnapshots || [];
                redoSnapshots = saved.redoSnapshots || match.redoBallSnapshots || [];
                match.lastBallSnapshots = undoSnapshots;
                match.redoBallSnapshots = redoSnapshots;
                match.lastBallSnapshotCount = undoSnapshots.length;
                match.redoBallSnapshotCount = redoSnapshots.length;
                pendingBatches = savedBatches;
                unsentBalls = savedUnsent;
                pendingBalls = unsentBalls.length
                    + pendingBatches.reduce((count, batch) => count + (batch.actions || []).length, 0);
                window.MATCH = match;
                handleMatchUpdate(match, false, true);
                showScoreNotice('Restored unconfirmed scoring from this device. Uploading it to the server now.');
            }
        } catch (err) {
            console.error('score_local_restore_failed', err);
            showScoreNotice('Local score recovery could not be read. The server score is shown; review it before continuing.');
        } finally {
            isRestoring = false;
            updateUndoBtn();
        }

        pendingBatches.forEach(enqueueBatchUpload);
        if (unsentBalls.length) flushBallQueue();
    }

    window.addEventListener('online', () => {
        if (!pendingBatches.length && !unsentBalls.length) return;
        uploadPaused = false;
        pendingBatches.forEach(enqueueBatchUpload);
        if (unsentBalls.length) flushBallQueue();
    });

    // Only the fields the shared rules can actually predict — excludes
    // statsAggregated (set server-side by aggregatePendingInningsStats,
    // not part of the ball rules) so that alone never causes a mismatch.
    function pickTeamForCompare(t) {
        if (!t) return t;
        const { statsAggregated, ...rest } = t;
        return rest;
    }
    function statesMatch(serverMatch, predictedMatch) {
        const pick = (m) => JSON.stringify({
            team1: pickTeamForCompare(m.team1),
            team2: pickTeamForCompare(m.team2),
            currentInnings: m.currentInnings,
            result: m.result,
            winnerKey: m.winnerKey,
            status: m.status,
        });
        return pick(serverMatch) === pick(predictedMatch);
    }

    // Undo/redo mutations are server-authoritative, so refresh their state
    // when one of those round trips cannot be confirmed.
    function resyncWithWarning(msg) {
        if (resyncTriggered) return;
        resyncTriggered = true;
        try { sessionStorage.setItem('scoreResyncMsg', msg); } catch (e) {}
        window.location.reload();
    }

    function applyOptimistic(body) {
        const predicted = JSON.parse(JSON.stringify(match));
        const predictedTeam = predicted[body.innings];
        if (!predictedTeam.overStarted) {
            predictedTeam.currentOverBalls = [];
            predictedTeam.currentOverRuns = 0;
            predictedTeam.overStarted = true;
        }
        const result = window.BallRules.applyBall(predicted, match.currentInnings, body);
        return result.ok ? predicted : null;
    }

    async function sendBallsInBackground(batch) {
        if (resyncTriggered) return;
        let authoritativeMatch = null;
        let serverRejectedBatch = false;
        try {
            const res = await fetch(`/turfs/live/${matchId}/balls`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ balls: batch.actions.map((action) => action.body) }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                serverRejectedBatch = true;
                const error = data.error || `request_failed_${res.status}`;
                throw new Error(error);
            }
            const acceptedIds = new Set(data.appliedActionIds || []);
            if (batch.actions.some((action) => !acceptedIds.has(action.body.clientActionId))) {
                serverRejectedBatch = true;
                authoritativeMatch = data.match;
                pendingBatches = [];
                unsentBalls = [];
                pendingBalls = 0;
                uploadPaused = true;
                scoreBlocked = true;
                match = authoritativeMatch;
                undoSnapshots = JSON.parse(JSON.stringify(match.lastBallSnapshots || undoSnapshots));
                redoSnapshots = JSON.parse(JSON.stringify(match.redoBallSnapshots || redoSnapshots));
                showScoreNotice('The server accepted only part of the queued scoring. Please review the saved score before continuing.');
            } else if (!statesMatch(data.match, batch.actions[batch.actions.length - 1].predicted)) {
                serverRejectedBatch = true;
                authoritativeMatch = data.match;
                pendingBatches = [];
                unsentBalls = [];
                pendingBalls = 0;
                uploadPaused = true;
                scoreBlocked = true;
                match = authoritativeMatch;
                showScoreNotice('The server score differed from the local preview. The saved server score has been restored; please review it.');
            } else {
                pendingBatches = pendingBatches.filter((queued) => queued.batchId !== batch.batchId);
                authoritativeMatch = data.match;
            }
            if (serverRejectedBatch) {
                preserveTeamLogos(authoritativeMatch, window.MATCH);
                handleMatchUpdate(authoritativeMatch, authoritativeMatch.status === 'completed', true);
                await persistLocalState();
                return;
            }
        } catch (err) {
            console.error('score_request_failed', err);
            uploadPaused = true;
            if (serverRejectedBatch) {
                showScoreNotice(`The server rejected this score action (${err.message || 'request error'}). It remains in the local journal for review.`);
            } else {
                showScoreNotice('Score is saved on this device but not confirmed by the server. Reconnect to retry.');
            }
            return;
        } finally {
            if (authoritativeMatch && !serverRejectedBatch) {
                pendingBalls = Math.max(0, pendingBalls - batch.actions.length);
            }
            if (!resyncTriggered && pendingBalls === 0 && pendingHistoryOps === 0 && authoritativeMatch && !serverRejectedBatch) {
                preserveTeamLogos(authoritativeMatch, match);
                match = authoritativeMatch;
                window.MATCH = match;
                team = match[match.currentInnings];
                if (redirectToSessionIfDone(match)) return;
                if (match.status === 'live' && isInningsOver(team)) {
                    window.location.href = `/turfs/live/${matchId}`;
                    return;
                }
            }
            if (authoritativeMatch) await persistLocalState();
            updateUndoBtn();
        }
    }

    function commitPendingScoring() {
        if (!pendingRunout && !pendingScoring) return true;
        if (needsInternet('Scoring')) return false;
        const previousInnings = match.currentInnings;
        const body = pendingRunout
            ? runoutBallBody(pendingRunout)
            : pendingScoring.body;
        pendingRunout = null;
        pendingScoring = null;
        renderPendingRunout();
        queueBall(body);
        if (match.status !== 'live' || match.currentInnings !== previousInnings) return false;
        const currentTeam = match[match.currentInnings];
        if (!currentTeam.strikerId || !currentTeam.nonStrikerId || !currentTeam.currentBowlerId) {
            showScoreNotice('Input recorded. Set the players before scoring the next ball.');
            return false;
        }
        return true;
    }

    // Applies a ball instantly and sends it in the background, in order.
    function queueBall(body) {
        if (isRestoring || scoreBlocked) return;
        if (match.status !== 'live') {
            showScoreNotice('The match is finished.');
            return;
        }
        if (needsInternet('Scoring')) return;
        if (!commitPendingScoring()) return;
        const fullBody = { innings: match.currentInnings, ...body, clientActionId: createActionId() };
        const beforeTeam = JSON.parse(JSON.stringify(match[match.currentInnings]));
        if (!beforeTeam.overStarted) {
            beforeTeam.currentOverBalls = [];
            beforeTeam.currentOverRuns = 0;
            beforeTeam.overStarted = true;
        }
        const predicted = applyOptimistic(fullBody);
        if (!predicted) {
            alert('Something went wrong: invalid_ball');
            return;
        }
        undoSnapshots.push({
            innings: match.currentInnings,
            currentInnings: match.currentInnings,
            team: beforeTeam,
        });
        if (undoSnapshots.length > 3) undoSnapshots.shift();
        redoSnapshots = [];
        predicted.lastBallSnapshotCount = undoSnapshots.length;
        predicted.redoBallSnapshotCount = 0;
        handleMatchUpdate(predicted, false);
        pendingBalls++;
        unsentBalls.push({ body: fullBody, predicted });
        persistLocalState();
        if (unsentBalls.length >= 6) {
            flushBallQueue();
        } else if (!ballFlushTimer) {
            ballFlushTimer = setTimeout(flushBallQueue, 180);
        }
    }

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

    const resyncMsg = (() => { try { return sessionStorage.getItem('scoreResyncMsg'); } catch (e) { return null; } })();
    if (resyncMsg) {
        try { sessionStorage.removeItem('scoreResyncMsg'); } catch (e) {}
        const toast = document.createElement('div');
        toast.className = 'score-resync-toast';
        toast.textContent = resyncMsg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
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
        const scoreValue = (scoreTeam, inningsKey) => {
            const score = `${scoreTeam.totalRuns || 0}/${scoreTeam.wickets || 0}`;
            const activeLimit = m.status === 'live' && m.currentInnings === inningsKey;
            if (!window.IS_ADMIN || !activeLimit) return `<div class="live-score-value">${score}</div>`;
            const limitLabel = scoreTeam.wicketLimit ? ` (limit ${scoreTeam.wicketLimit})` : '';
            return `<button type="button" class="live-score-value live-score-value-editable" data-wicket-limit="${inningsKey}" title="Click to set or clear this innings' wicket limit">${score}<span class="live-wicket-limit-label">${limitLabel}</span></button>`;
        };

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
                        ${m.status === 'live' ? `
                            <button type="button" class="live-end-innings-btn" data-action="end-innings" title="End innings" aria-label="End innings">
                                <i class="fa-solid fa-flag-checkered" aria-hidden="true"></i>
                            </button>
                        ` : ''}
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
                        ${scoreValue(leftTeam, leftKey)}
                        <div class="live-score-overs">(${oversDisplayTop(leftTeam.legalBalls || 0)} ov)</div>
                        ${window.IS_ADMIN && m.status === 'live' ? '<div class="live-wicket-limit-hint">Tap score to set wicket limit</div>' : ''}
                    </div>

                    <div class="live-score-vs">VS</div>

                    <div class="live-score-mid ${rightTeamDone ? 'live-innings-done' : ''}">
                        ${scoreValue(rightTeam, rightKey)}
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

    // Keep the scorer open after completion while its undo history remains.
    function redirectToSessionIfDone(m) {
        if (m && m.status === 'completed') {
            if (m.tournamentId) {
                window.location.href = `/tcl/session/${m.tournamentId}?addMatch=1`;
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
        const wicketCap = match.isSuperOver ? 2 : (t.wicketLimit || (t.batting ? t.batting.length - 1 : 10));
        return t.legalBalls >= match.overs * 6 || t.wickets >= wicketCap || !!t.endedEarly;
    }

    function updateUndoBtn() {
        const isMainLevel = currentLevel() === 'main';
        const undoCount = historyCount(match, 'lastBallSnapshotCount', 'lastBallSnapshots');
        scorePadUndoBtn.style.display = isMainLevel && undoCount > 0 ? '' : 'none';
        scorePadUndoBtn.title = undoCount > 0 ? `Undo last ball (${undoCount} left)` : 'Undo last ball';
        scorePadUndoBtn.disabled = isRestoring || scoreBlocked || uploadPaused || isSubmitting;

        const redoCount = historyCount(match, 'redoBallSnapshotCount', 'redoBallSnapshots');
        scorePadRedoBtn.style.display = isMainLevel && redoCount > 0 ? '' : 'none';
        scorePadRedoBtn.title = redoCount > 0 ? `Redo last ball (${redoCount} available)` : 'Redo last ball';
        scorePadRedoBtn.disabled = isRestoring || scoreBlocked || uploadPaused || isSubmitting;
    }

    function historyCount(matchState, countKey, snapshotsKey) {
        return Number.isInteger(matchState[countKey])
            ? matchState[countKey]
            : (matchState[snapshotsKey] || []).length;
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

    function handleMatchUpdate(updatedMatch, allowRedirect = true, suppressBowlerPrompt = false) {
        if (!updatedMatch) return;
        if (allowRedirect && redirectToSessionIfDone(updatedMatch)) return;

        preserveTeamLogos(updatedMatch, match);
        match = updatedMatch;
        window.MATCH = match;
        team = match[match.currentInnings];

        const isSetUp = !!(team && team.strikerId && team.nonStrikerId && team.currentBowlerId);
        if (allowRedirect && match.status === 'live' && isInningsOver(team)) {
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
        showPadOrSetup(isSetUp);
        if (!suppressBowlerPrompt) checkOverAndPromptBowler();
    }

    function findRow(list, id) {
        return (list || []).find((p) => String(p.id) === String(id));
    }

    // Every leaf tap submits immediately — no separate Done step. This is
    // used directly for runs/dot/wide/no-ball (the branches with no
    // further "who/what" questions attached to them). Applies instantly
    // and queues the network call — see queueBall above.
    function submitDirect(body) {
        queueBall(body);
    }

    const scorePadHeader = document.getElementById('scorePadHeader');
    const scorePadBackBar = document.getElementById('scorePadBackBar');
    const scorePadGrid = document.getElementById('scorePadGrid');
    const scorePadUndoBtn = document.getElementById('scorePadUndoBtn');
    const scorePadRedoBtn = document.getElementById('scorePadRedoBtn');
    const scorePadCloseBtn = document.getElementById('scorePadCloseBtn');
    const pendingRunoutCard = document.getElementById('pendingRunoutCard');
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
        cardPickerGrid.innerHTML = Array.from({ length: Math.ceil(players.length / 10) }, (_, pageIndex) => `
            <div class="ig-picker-page">
                ${players.slice(pageIndex * 10, pageIndex * 10 + 10).map((p) => `
                    <div class="ig-picker-item" data-id="${p.id}">
                        <div class="ig-picker-avatar-ring">
                            <img src="${p.image}" alt="${p.name}" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';">
                            <span class="ig-picker-check"><i class="fa-solid fa-check"></i></span>
                        </div>
                        <span class="ig-picker-name">${p.name}</span>
                    </div>
                `).join('')}
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

    document.getElementById('liveScoreSummaryWrapper').addEventListener('click', async (event) => {
        if (!event.target.closest('[data-action="end-innings"]') || isActionLocked()) return;
        if (needsInternet('Ending the innings')) return;
        if (!confirm('End this innings now with the current score? Use this only when there are no batsmen left to bring in.')) return;
        try {
            flushBallQueue();
            await requestChain;
            const data = await postJson(`/turfs/live/${matchId}/end-innings`, {
                innings: match.currentInnings,
            });
            handleMatchUpdate(data.match);
        } catch (err) {
            console.error('end_innings_failed', err);
        }
    });

    function pickOutPlayer(callback) {
        const strikerRow = findRow(team.batting, team.strikerId);
        const nonStrikerRow = findRow(team.batting, team.nonStrikerId);
        const pool = [strikerRow, nonStrikerRow].filter(Boolean);
        openCardPicker(pool, 'Who Got Run Out?', (id) => {
            outPlayerId = id;
            callback();
        });
    }

    function runoutBallBody(runout) {
        return {
            type: 'out',
            outType: 'runout',
            outPlayerId: runout.outPlayerId,
            fielderId: runout.fielderId,
            newBatsmanId: runout.newBatsmanId || null,
            runoutRuns: runout.runoutRuns,
            isNoBall: runout.isNoBall,
        };
    }

    function noBallBody(option) {
        const runsByOption = { dot: 0, one: 1, two: 2, three: 3, four_run: 4, five: 5, four: 4, six: 6 };
        return {
            type: 'noball',
            noballRuns: runsByOption[option],
            noballBoundary: option === 'four' ? 'four' : (option === 'six' ? 'six' : null),
        };
    }

    function renderPendingRunout() {
        if (currentLevel() !== 'main') {
            pendingRunoutCard.hidden = true;
            pendingRunoutCard.innerHTML = '';
            return;
        }
        if (!pendingRunout) {
            if (pendingScoring) renderPendingScoring();
            else {
                pendingRunoutCard.hidden = true;
                pendingRunoutCard.innerHTML = '';
            }
            return;
        }
        const fielder = findRow(team.bowling, pendingRunout.fielderId);
        const batter = findRow(team.batting, pendingRunout.outPlayerId);
        if (!fielder || !batter) {
            pendingRunoutCard.hidden = true;
            pendingRunoutCard.innerHTML = '';
            return;
        }
        const playerButton = (role, player) => `
            <button type="button" class="pending-runout-player" data-edit-runout-player="${role}">
                <img src="${escapeHtml(player.image || '/images/placeholder-player.svg')}" alt="${escapeHtml(player.name)}" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';">
                <span>${escapeHtml(player.name)}</span>
            </button>
        `;
        pendingRunoutCard.innerHTML = `
            <div class="pending-runout-details">
                <strong class="pending-runout-title">Run Out</strong>
                ${playerButton('fielder', fielder)}
                ${playerButton('batter', batter)}
                <button type="button" class="pending-runout-runs" data-edit-runout-runs>
                    ${pendingRunout.runoutRuns} run${pendingRunout.runoutRuns === 1 ? '' : 's'}
                </button>
            </div>
            <div class="pending-runout-actions">
                <button type="button" class="pending-runout-confirm" data-confirm-runout aria-label="Confirm run out">
                    <i class="fa-solid fa-check"></i>
                </button>
                <button type="button" class="pending-runout-cancel" data-cancel-runout aria-label="Discard run out">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
        pendingRunoutCard.hidden = false;
    }

    function noBallLabel(body) {
        if (body.noballBoundary === 'four') return 'No Ball + Four';
        if (body.noballBoundary === 'six') return 'No Ball + Six';
        const runs = Number(body.noballRuns || 0);
        return `No Ball + ${runs} Run${runs === 1 ? '' : 's'}`;
    }

    function renderPendingScoring() {
        if (pendingScoring.kind === 'noball') {
            pendingRunoutCard.innerHTML = `
                <div class="pending-runout-details">
                    <strong class="pending-runout-title">Pending</strong>
                    <button type="button" class="pending-runout-runs" data-edit-pending-noball>
                        ${escapeHtml(noBallLabel(pendingScoring.body))}
                    </button>
                </div>
                <div class="pending-runout-actions">
                    <button type="button" class="pending-runout-confirm" data-confirm-pending aria-label="Confirm no ball">
                        <i class="fa-solid fa-check"></i>
                    </button>
                    <button type="button" class="pending-runout-cancel" data-cancel-pending aria-label="Discard no ball">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            `;
            pendingRunoutCard.hidden = false;
            return;
        }

        const { body } = pendingScoring;
        const fielder = findRow(team.bowling, body.fielderId);
        if (!fielder) {
            pendingRunoutCard.hidden = true;
            pendingRunoutCard.innerHTML = '';
            return;
        }
        const playerButton = (role, player) => `
            <button type="button" class="pending-runout-player" data-edit-pending-player="${role}">
                <img src="${escapeHtml(player.image || '/images/placeholder-player.svg')}" alt="${escapeHtml(player.name)}" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';">
                <span>${escapeHtml(player.name)}</span>
            </button>
        `;
        const isStumpingOut = body.outType === 'stumping';
        const title = body.outType === 'catch' ? 'Caught' : (body.isWide ? 'Stumped + Wide' : 'Stumped');
        // Stumped: tapping the title switches between Stumped / Stumped + Wide.
        const titleHtml = isStumpingOut
            ? `<button type="button" class="pending-runout-runs" data-toggle-wide-stump>${title}</button>`
            : `<strong class="pending-runout-title">${title}</strong>`;
        pendingRunoutCard.innerHTML = `
            <div class="pending-runout-details">
                ${titleHtml}
                ${playerButton('fielder', fielder)}
            </div>
            <div class="pending-runout-actions">
                <button type="button" class="pending-runout-confirm" data-confirm-pending aria-label="Confirm ${title.toLowerCase()}">
                    <i class="fa-solid fa-check"></i>
                </button>
                <button type="button" class="pending-runout-cancel" data-cancel-pending aria-label="Discard ${title.toLowerCase()}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
        pendingRunoutCard.hidden = false;
    }

    pendingRunoutCard.addEventListener('click', (event) => {
        const target = event.target.closest('button');
        if (!target) return;

        if (target.hasAttribute('data-edit-pending-player')) {
            if (!pendingScoring || pendingScoring.kind !== 'dismissal') return;
            const role = target.dataset.editPendingPlayer;
            const isStumping = pendingScoring.body.outType === 'stumping';
                        if (role !== 'fielder') return;
            const players = team.bowling.filter((player) => !isStumping || String(player.id) !== String(team.currentBowlerId));
            openCardPicker(players, isStumping ? 'Who Stumped It?' : 'Who Caught It?', (id) => {
                if (!pendingScoring) return;
                pendingScoring.body.fielderId = id;
                renderPendingRunout();
                persistLocalState();
            });
            return;
        }

        if (target.hasAttribute('data-toggle-wide-stump')) {
            if (!pendingScoring || pendingScoring.kind !== 'dismissal'
                || pendingScoring.body.outType !== 'stumping') return;
            const body = pendingScoring.body;
            body.isWide = !body.isWide;
            // A wide stumping is not a legal ball, so whether a new batsman
            // is needed (last ball of the innings) can change when toggling.
            if (!newBatsmanRequired(!body.isWide)) {
                body.newBatsmanId = null;
            } else if (!body.newBatsmanId) {
                pickNewBatsman(() => {
                    if (!pendingScoring) return;
                    pendingScoring.body.newBatsmanId = newBatsmanId;
                    newBatsmanId = null;
                    renderPendingRunout();
                    persistLocalState();
                }, !body.isWide);
            }
            renderPendingRunout();
            persistLocalState();
            return;
        }

        if (target.hasAttribute('data-edit-pending-noball')) {
            navStack = ['main', 'noball'];
            renderScorePad();
            return;
        }

        if (target.hasAttribute('data-cancel-pending')) {
            pendingScoring = null;
            renderPendingRunout();
            persistLocalState();
            return;
        }

        if (target.hasAttribute('data-confirm-pending')) {
            if (!pendingScoring || isRestoring || scoreBlocked || isSubmitting || match.status !== 'live') return;
            if (needsInternet('Scoring')) return;
            const body = pendingScoring.body;
            pendingScoring = null;
            renderPendingRunout();
            queueBall(body);
            return;
        }

        if (target.hasAttribute('data-edit-runout-player')) {
            const role = target.dataset.editRunoutPlayer;
            const players = role === 'fielder'
                ? team.bowling
                : [findRow(team.batting, team.strikerId), findRow(team.batting, team.nonStrikerId)].filter(Boolean);
            openCardPicker(players, role === 'fielder' ? 'Who Ran Out the Batter?' : 'Who Got Run Out?', (id) => {
                if (!pendingRunout) return;
                if (role === 'fielder') pendingRunout.fielderId = id;
                else pendingRunout.outPlayerId = id;
                renderPendingRunout();
                persistLocalState();
            });
            return;
        }

        if (target.hasAttribute('data-edit-runout-runs')) {
            navStack = ['main', 'runoutRuns'];
            renderScorePad();
            return;
        }

        if (target.hasAttribute('data-cancel-runout')) {
            pendingRunout = null;
            resetOutState();
            navStack = ['main'];
            renderScorePad();
            persistLocalState();
            return;
        }

        if (target.hasAttribute('data-confirm-runout')) {
            const confirmedRunout = pendingRunout;
            if (!confirmedRunout) return;
            if (isRestoring || scoreBlocked || isSubmitting || match.status !== 'live') return;
            if (needsInternet('Scoring')) return;
            pendingRunout = null;
            resetOutState();
            navStack = ['main'];
            renderScorePad();
            queueBall(runoutBallBody(confirmedRunout));
        }
    });

    // Either no one's left in the squad (all out), or this wicket is
    // itself the last legal ball of the overs — either way the
    // innings is over and there's no new batsman to pick.
    function newBatsmanRequired(isLegalBall) {
        const eligible = team.batting.filter((p) => p.status === 'yet_to_bat');
        const inningsEndingBall = isLegalBall && (team.legalBalls + 1) >= (match.overs * 6);
        return eligible.length > 0 && !inningsEndingBall;
    }

    function pickNewBatsman(callback, isLegalBall) {
        if (!newBatsmanRequired(isLegalBall)) {
            newBatsmanId = null;
            if (callback) callback();
            return;
        }
        const eligible = team.batting.filter((p) => p.status === 'yet_to_bat');
        openCardPicker(eligible, 'New Batsman', (id) => {
            newBatsmanId = id;
            if (callback) callback();
        });
    }

    // Run Out flow — shared by regular and no-ball run-outs. The fielder,
    // dismissed batter, and completed runs are staged for review before submit.
    function startRunoutFlow(isNoBall) {
        if (pendingRunout) {
            showScoreNotice('Confirm or discard the pending run out before entering another run out.');
            return;
        }
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

    function startMankadFlow() {
        resetOutState();
        const eligible = team.batting.filter((p) => p.status === 'yet_to_bat');
        if (!eligible.length) {
            queueBall({ type: 'mankad', newBatsmanId: null });
            return;
        }
        openCardPicker(eligible, 'New Batter After Mankad', (id) => {
            queueBall({ type: 'mankad', newBatsmanId: id });
        });
    }

    // Handles every dismissal that needs more than one piece of info
    // (catch/bowled/hitwicket/stumping/retired/obstructing/runout).
    // Runs/dot/wide/no-ball never reach this — they submit via submitDirect.
    // Applies instantly and queues the network call — see queueBall above.
    function submitBall() {
        let body;
        if (outType === 'runout') {
            body = {
                type: 'out',
                outType: 'runout',
                outPlayerId,
                fielderId,
                newBatsmanId,
                runoutRuns,
                isNoBall: isNoBallRunout,
            };
        } else if (outType === 'retired') {
            body = { type: 'retire', outPlayerId, newBatsmanId };
        } else if (outType === 'catch') {
            body = { type: 'out', outType: 'catch', fielderId, newBatsmanId };
        } else if (outType === 'obstructing') {
            body = { type: 'out', outType: 'obstructing', outPlayerId, newBatsmanId };
        } else {
            // bowled / hitwicket / stumping (stumping can optionally be
            // off a wide — penalty run, ball doesn't count as legal)
            body = {
                type: 'out',
                outType,
                newBatsmanId,
                fielderId: outType === 'stumping' ? fielderId : undefined,
                isWide: outType === 'stumping' ? isWideStumping : undefined,
            };
        }
        queueBall(body);
    }

    function renderScorePad() {
        const level = currentLevel();
        scorePadHeader.textContent = headerLabels[level] || 'Score Ball';
        scorePadBackBar.style.display = level === 'main' ? 'none' : 'flex';
        scorePadCloseBtn.style.display = 'none';
        updateUndoBtn();
        renderPendingRunout();
        scorePadGrid.classList.toggle('score-pad-grid-main', level === 'main');
        scorePadGrid.classList.toggle('score-pad-grid-numbers', level === 'moreRuns');
        scorePadGrid.classList.toggle('score-pad-grid-nb', level === 'noball');
        

        if (level === 'main') {
            // ---- Root: runs are direct leaves now (classic pad layout).
            // Only Out / No Ball push a child level; Wide submits
            // immediately; Run Out opens its picker chain straight away;
            // "5, 7+" opens a small follow-up asking the exact run count
            // for anything above the standard buttons. ----
            scorePadGrid.innerHTML = `
                <button type="button" class="score-pad-btn" data-action="morerun">1,2,3 (Running)</button>
                <button type="button" class="score-pad-btn score-pad-btn-parent" data-parent="wide">
                    <i class="fa-solid fa-arrows-left-right"></i>
                    <span>Wide</span>
                </button>
                <button type="button" class="score-pad-btn" data-run="four">4 (Four)</button>
                <button type="button" class="score-pad-btn" data-run="six">6 (Six)</button>
                <button type="button" class="score-pad-btn" data-run="one_nr">1 (No Rotation)</button>
                <button type="button" class="score-pad-btn score-pad-btn-parent" data-parent="out">
                    <i class="fa-solid fa-xmark"></i>
                    <span>Out</span>
                </button>
                <button type="button" class="score-pad-btn score-pad-btn-parent score-pad-btn-span2" data-parent="noball">
                    <i class="fa-solid fa-shoe-prints"></i>
                    <span>No Ball</span>
                </button>
            `;
        } else if (level === 'moreRuns') {
            const runTypes = ['dot', 'one', 'two', 'three'];
            scorePadGrid.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => (n < 4
                ? `<button type="button" class="score-pad-btn" data-run="${runTypes[n]}">${n}</button>`
                : `<button type="button" class="score-pad-btn" data-morerun="${n}">${n}</button>`
            )).join('');
        } else if (level === 'out') {
            scorePadGrid.innerHTML = `
                <button type="button" class="score-pad-btn" data-dismissal="bowled">Bowled</button>
                <button type="button" class="score-pad-btn" data-dismissal="catch">Caught</button>
                <button type="button" class="score-pad-btn" data-action="stumpedmore">Stumped</button>
                <button type="button" class="score-pad-btn" data-action="regularrunout">Run Out</button>
                <button type="button" class="score-pad-btn" data-dismissal="retired">Retired Out</button>
                <button type="button" class="score-pad-btn" data-dismissal="obstructing">Obstructing the Field</button>
                <button type="button" class="score-pad-btn" data-dismissal="hitwicket">Hit Wicket</button>
                <button type="button" class="score-pad-btn" data-action="mankad">Mankad</button>
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
                <button type="button" class="score-pad-btn" data-nb="four">No Ball + Four</button>
                <button type="button" class="score-pad-btn" data-nb="two">No Ball +2</button>
                <button type="button" class="score-pad-btn" data-nb="six">No Ball + Six</button>
                <button type="button" class="score-pad-btn" data-nb="three">No Ball +3</button>
                <button type="button" class="score-pad-btn" data-action="nbrunout">No Ball + Run Out</button>
                <button type="button" class="score-pad-btn" data-nb="four_run">No Ball +4</button>
                <button type="button" class="score-pad-btn" data-nb="five">No Ball +5</button>
            `;
        } else if (level === 'runoutRuns') {
            scorePadGrid.innerHTML = [0, 1, 2, 3, 4, 5].map((n) => `
                <button type="button" class="score-pad-btn" data-runoutruns="${n}">${n} run${n === 1 ? '' : 's'}</button>
            `).join('');
        } else if (level === 'runout') {
            scorePadGrid.innerHTML = `
                <button type="button" class="score-pad-btn" data-action="regularrunout">Run Out</button>
                <button type="button" class="score-pad-btn" data-action="mankad">Mankad (Non-Striker)</button>
            `;
        }

        scorePadGrid.querySelectorAll('.score-pad-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (isSubmitting) return;
                btn.classList.add('score-pad-btn-pressed');
                setTimeout(() => btn.classList.remove('score-pad-btn-pressed'), 320);

                if ((pendingRunout || pendingScoring) && scorePadGrid.contains(btn)) {
                    if (pendingScoring && pendingScoring.kind === 'noball'
                        && currentLevel() === 'noball' && btn.dataset.nb) {
                        pendingScoring.body = noBallBody(btn.dataset.nb);
                        navStack = ['main'];
                        renderScorePad();
                        persistLocalState();
                        return;
                    }
                    const editingRunoutRuns = pendingRunout && currentLevel() === 'runoutRuns'
                        && btn.dataset.runoutruns !== undefined;
                    if (!editingRunoutRuns && !commitPendingScoring()) return;
                }

                // ---- root: parent nodes ----
                // ---- root: parent nodes (Out / No Ball push a level,
                // Wide submits immediately, Run Out opens its picker
                // chain straight away) ----
                if (btn.dataset.parent) {
                    const parent = btn.dataset.parent;
                    if (parent === 'wide') {
                        submitDirect({ type: 'wide' });
                    } else if (parent === 'runout') {
                        pushLevel('runout');
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
                        // Striker is always the one out. After the fielder
                        // is chosen, ask for the new batsman straight away.
                        pickFielder(() => {
                            pickNewBatsman(() => {
                                pendingScoring = {
                                    kind: 'dismissal',
                                    body: {
                                        type: 'out',
                                        outType: 'catch',
                                        outPlayerId: team.strikerId,
                                        fielderId,
                                        newBatsmanId,
                                    },
                                };
                                navStack = ['main'];
                                resetOutState();
                                renderScorePad();
                                persistLocalState();
                            }, true);
                        });
                    } else if (outType === 'stumping') {
                        // Striker is always the one out. After the stumper
                        // is chosen, ask for the new batsman straight away.
                        pickStumper(() => {
                            pickNewBatsman(() => {
                                pendingScoring = {
                                    kind: 'dismissal',
                                    body: {
                                        type: 'out',
                                        outType: 'stumping',
                                        outPlayerId: team.strikerId,
                                        fielderId,
                                        newBatsmanId,
                                        isWide: isWideStumping,
                                    },
                                };
                                navStack = ['main'];
                                resetOutState();
                                renderScorePad();
                                persistLocalState();
                            }, !isWideStumping);
                        });
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

                if (btn.dataset.action === 'regularrunout') {
                    startRunoutFlow(false);
                    return;
                }
                if (btn.dataset.action === 'mankad') {
                    startMankadFlow();
                    return;
                }

                // ---- stage no-ball details for review before submission ----
                if (btn.dataset.nb) {
                    pendingScoring = { kind: 'noball', body: noBallBody(btn.dataset.nb) };
                    navStack = ['main'];
                    renderScorePad();
                    persistLocalState();
                    return;
                }

                if (btn.dataset.action === 'nbrunout') {
                    startRunoutFlow(true);
                    return;
                }

                // ---- run-out runs-completed sub-screen ----
                if (btn.dataset.runoutruns !== undefined) {
                    runoutRuns = Number(btn.dataset.runoutruns);
                    if (pendingRunout) {
                        // Editing the runs of an already staged run out:
                        // the new batsman was already chosen, don't ask again.
                        pendingRunout.runoutRuns = runoutRuns;
                        resetOutState();
                        navStack = ['main'];
                        renderScorePad();
                        persistLocalState();
                        return;
                    }
                    // New run out: right after the runs are entered, ask
                    // for the new batsman (skipped if the innings is over).
                    const stagedRunout = {
                        fielderId,
                        outPlayerId,
                        runoutRuns,
                        isNoBall: isNoBallRunout,
                        newBatsmanId: null,
                    };
                    pickNewBatsman(() => {
                        stagedRunout.newBatsmanId = newBatsmanId;
                        pendingRunout = stagedRunout;
                        resetOutState();
                        navStack = ['main'];
                        renderScorePad();
                        persistLocalState();
                    }, !stagedRunout.isNoBall);
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

    function previewUndo() {
        const snap = undoSnapshots.pop();
        if (!snap) return null;
        const preview = JSON.parse(JSON.stringify(match));
        const teamAfterBall = JSON.parse(JSON.stringify(preview[snap.innings]));
        let ballEventIndex = -1;
        for (let index = (preview.ballEvents || []).length - 1; index >= 0; index--) {
            const event = preview.ballEvents[index];
            if (event.innings === snap.innings && event.payload) {
                ballEventIndex = index;
                break;
            }
        }
        const ballEvent = ballEventIndex >= 0 ? preview.ballEvents[ballEventIndex] : null;
        redoSnapshots.push({
            innings: snap.innings,
            currentInnings: preview.currentInnings,
            team: teamAfterBall,
            ballEvent,
            ballEventIndex,
        });
        if (redoSnapshots.length > 3) redoSnapshots.shift();
        preview[snap.innings] = snap.team;
        if (ballEventIndex >= 0) preview.ballEvents.splice(ballEventIndex, 1);
        preview.currentInnings = snap.currentInnings;
        preview.lastBallSnapshotCount = undoSnapshots.length;
        preview.redoBallSnapshotCount = redoSnapshots.length;
        return preview;
    }

    function previewRedo() {
        const snap = redoSnapshots.pop();
        if (!snap) return null;
        const preview = JSON.parse(JSON.stringify(match));
        undoSnapshots.push({
            innings: snap.innings,
            currentInnings: preview.currentInnings,
            team: JSON.parse(JSON.stringify(preview[snap.innings])),
        });
        if (undoSnapshots.length > 3) undoSnapshots.shift();
        preview[snap.innings] = snap.team;
        if (snap.ballEvent) {
            const eventIndex = Math.max(0, Math.min(snap.ballEventIndex, (preview.ballEvents || []).length));
            if (!preview.ballEvents) preview.ballEvents = [];
            preview.ballEvents.splice(eventIndex, 0, snap.ballEvent);
        }
        preview.currentInnings = snap.currentInnings;
        preview.lastBallSnapshotCount = undoSnapshots.length;
        preview.redoBallSnapshotCount = redoSnapshots.length;
        return preview;
    }

    // Instant undo/redo: the screen updates on the click itself. The server
    // call is queued on requestChain, so it always runs after pending balls
    // and in click order, and rapid taps never get dropped.
    function queueHistoryOp(kind) {
        if (isRestoring || scoreBlocked || uploadPaused || isSubmitting) return;
        if (!navigator.onLine) {
            showScoreNotice('You are offline. Undo/redo works once the connection is back.');
            return;
        }
        const preview = kind === 'undo' ? previewUndo() : previewRedo();
        if (!preview) return;
        flushBallQueue(); // make sure any unsent balls are queued before this op
        pendingHistoryOps++;
        handleMatchUpdate(preview, false, true);

        requestChain = requestChain.then(async () => {
            if (resyncTriggered) return;
            if (uploadPaused || scoreBlocked) {
                pendingHistoryOps = Math.max(0, pendingHistoryOps - 1);
                resyncWithWarning(`${kind === 'undo' ? 'Undo' : 'Redo'} was not saved — showing the saved score.`);
                return;
            }
            try {
                const res = await fetch(`/turfs/live/${matchId}/${kind}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                });
                const data = await res.json();
                if (!res.ok || !data.ok) throw new Error(data.error || 'request_failed');
                pendingHistoryOps = Math.max(0, pendingHistoryOps - 1);
                // Only sync from the server once everything is settled.
                if (pendingHistoryOps === 0 && pendingBalls === 0) {
                    if (statesMatch(data.match, match)) {
                        preserveTeamLogos(data.match, match);
                        match = data.match;
                        window.MATCH = match;
                        team = match[match.currentInnings];
                        updateUndoBtn();
                    } else {
                        handleMatchUpdate(data.match, false, true);
                    }
                }
            } catch (err) {
                pendingHistoryOps = Math.max(0, pendingHistoryOps - 1);
                resyncWithWarning(`${kind === 'undo' ? 'Undo' : 'Redo'} could not be confirmed — refreshing the saved match.`);
            }
        });
    }
    scorePadUndoBtn.addEventListener('click', () => queueHistoryOp('undo'));
    scorePadRedoBtn.addEventListener('click', () => queueHistoryOp('redo'));

        // Asks what the bowler change is for. "Wrong bowler" is only offered while the
    // over is still running and its starting figures are known.
    function canFixWrongBowler() {
        const base = team.overBowlerBase;
        return !!(team.overStarted && !team.statsAggregated && base
            && base.over === Math.floor((team.legalBalls || 0) / 6)
            && String(base.bowlerId) === String(team.currentBowlerId));
    }
    function askBowlerChangeType(canFix) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;';
            const btn = 'padding:14px 10px;border-radius:12px;border:1px solid #444;background:#2a2a2a;color:#fff;font-size:15px;cursor:pointer;touch-action:manipulation;';
            overlay.innerHTML = `
                <div style="background:#161616;border-radius:16px;padding:16px;width:100%;max-width:340px;display:grid;gap:10px;">
                    <div style="color:#fff;font-weight:600;text-align:center;">Change bowler</div>
                    <button type="button" data-choice="change" style="${btn}">1. Bowler change<br><small>New bowler continues this over</small></button>
                    <button type="button" data-choice="wrong" style="${btn}${canFix ? '' : 'opacity:.4;'}" ${canFix ? '' : 'disabled'}>2. Wrong bowler<br><small>${canFix ? 'Move this over to the correct bowler' : 'Not possible now. Use Undo.'}</small></button>
                    <button type="button" data-choice="cancel" style="${btn}">Cancel</button>
                </div>`;
            overlay.addEventListener('click', (ev) => {
                const choice = ev.target.closest('[data-choice]')?.dataset.choice || (ev.target === overlay ? 'cancel' : null);
                if (!choice) return;
                overlay.remove();
                resolve(choice);
            });
            document.body.appendChild(overlay);
        });
    }

    document.getElementById('liveScoreSummaryWrapper').addEventListener('click', async (e) => {
        if (!e.target.closest('.live-bowler-col .live-player-line') || isActionLocked()) return;
        if (needsInternet('Changing the bowler')) return;
        let wrong = false;
        if (team.overStarted) {
            const choice = await askBowlerChangeType(canFixWrongBowler());
            if (choice !== 'change' && choice !== 'wrong') return;
            wrong = choice === 'wrong';
        }
        const pool = team.bowling.filter((p) => String(p.id) !== String(team.currentBowlerId));
        openCardPicker(pool, wrong ? 'Wrong Bowler: Pick Correct Bowler' : 'Change Bowler', async (id) => {
            try {
                flushBallQueue();
                await requestChain;
                const innings = match.currentInnings;
                const fromId = team.currentBowlerId;
                const data = await postJson(`/turfs/live/${matchId}/setup`, {
                    innings,
                    bowlerId: id,
                    wrongBowler: wrong,
                });
                if (wrong) {
                    undoSnapshots.concat(redoSnapshots).forEach((snap) => {
                        if (snap.innings === innings && snap.team) window.BallRules.applyBall.transferBowlerSpell(snap.team, fromId, id);
                    });
                }
                redoSnapshots = []; // the server clears redo after a setup change
                handleMatchUpdate(data.match);
            } catch (err) {
                console.error(err);
            }
        });
    });

    // A current batter is replaceable only while their scorecard is still 0/0.
    function canChangeBatter(role) {
        const id = team && team[role === 'striker' ? 'strikerId' : 'nonStrikerId'];
        if (!id) return true;
        const row = findRow(team.batting, id);
        return !!row && row.status === 'batting' && !team.statsAggregated;
    }
    function hasChangeableBatter() {
        return canChangeBatter('striker') || canChangeBatter('nonStriker');
    }
    function updateSetupRoleAvailability() {
        document.querySelectorAll('#scoreSetupForm .role-pick-btn[data-role="striker"], #scoreSetupForm .role-pick-btn[data-role="nonStriker"]')
            .forEach((button) => { button.disabled = !canChangeBatter(button.dataset.role); });
    }
    function updateEditablePlayers() {
        document.getElementById('liveScoreSummaryWrapper').classList.toggle('can-edit-players', hasChangeableBatter());
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
        updateSetupRoleAvailability();
        // The bowler is changed by tapping the bowler on the score summary,
        // so this popup only asks for one while the innings has no bowler yet.
        document.getElementById('spBowlerGroup').style.display = team.currentBowlerId ? 'none' : '';
        scoreSetupOverlay.style.display = 'flex';
    }

    // Rotate Strike: swaps striker and non-striker (use when the strike was
    // entered wrong and undo is no longer possible). Takes effect on Save.
    document.getElementById('rotateStrikeBtn').addEventListener('click', () => {
        if (!setupPicks.striker || !setupPicks.nonStriker) {
            showScoreNotice('Select both batters before rotating the strike.');
            return;
        }
        const previousStriker = setupPicks.striker;
        setupPicks.striker = setupPicks.nonStriker;
        setupPicks.nonStriker = previousStriker;
        showSetupChip('striker');
        showSetupChip('nonStriker');
    });

    document.getElementById('liveScoreSummaryWrapper').addEventListener('click', (e) => {
        const limitButton = e.target.closest('[data-wicket-limit]');
        if (limitButton && !isActionLocked()) {
            if (needsInternet('Setting the wicket limit')) return;
            const innings = limitButton.dataset.wicketLimit;
            const selectedTeam = match[innings];
            const maxLimit = match.isSuperOver ? 2 : Math.max(1, selectedTeam.batting.length - 1);
            const current = selectedTeam.wicketLimit == null ? '' : String(selectedTeam.wicketLimit);
            const answer = window.prompt(
                `Set wicket limit for ${selectedTeam.name} (1-${maxLimit}). Leave blank to use the normal all-out limit.`,
                current,
            );
            if (answer === null) return;
            const value = answer.trim() === '' ? null : Number(answer);
            if (value !== null && (!Number.isInteger(value) || value < 1 || value > maxLimit || value < selectedTeam.wickets)) {
                window.alert(`Enter a whole number from ${Math.max(1, selectedTeam.wickets)} to ${maxLimit}.`);
                return;
            }
            isSubmitting = true;
            flushBallQueue();
            requestChain.then(async () => {
                try {
                    const data = await postJson(`/turfs/live/${matchId}/wicket-limit`, { innings, wicketLimit: value });
                    handleMatchUpdate(data.match);
                } catch (err) {
                    window.alert(err.message || 'Could not update wicket limit.');
                } finally {
                    isSubmitting = false;
                }
            });
            return;
        }
        if (e.target.closest('.live-batters-col') && hasChangeableBatter() && !isActionLocked()) {
            if (needsInternet('Changing batters')) return;
            openSetupForm();
        }
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
        if (isActionLocked() || needsInternet('Saving players')) return;
        if (!setupPicks.striker || !setupPicks.nonStriker || !setupPicks.bowler) {
            alert('Please select striker, non-striker and bowler.');
            return;
        }
                // A batter who already scored is being replaced: his runs and balls move to the new batter.
        const swaps = [];
        [['striker', team.strikerId], ['nonStriker', team.nonStrikerId]].forEach(([role, oldId]) => {
            const newId = setupPicks[role];
            const row = oldId ? findRow(team.batting, oldId) : null;
            // Swapping striker and non-striker is not a replacement: no runs move.
            const stillBatting = [setupPicks.striker, setupPicks.nonStriker].map(String).includes(String(oldId));
            if (row && !stillBatting && String(oldId) !== String(newId) && ((row.runs || 0) > 0 || (row.balls || 0) > 0)) {
                swaps.push({ fromId: oldId, toId: newId, row });
            }
        });
        if (swaps.length && !confirm(swaps.map((s) => {
            const to = findRow(team.batting, s.toId);
            return `Move ${s.row.runs} (${s.row.balls}) from ${s.row.name} to ${to ? to.name : 'the new batter'}?`;
        }).join('\n'))) return;
        isSubmitting = true;
        try {
            flushBallQueue();
            await requestChain;
            const innings = match.currentInnings;
            const data = await postJson(`/turfs/live/${matchId}/setup`, {
                innings,
                strikerId: setupPicks.striker,
                nonStrikerId: setupPicks.nonStriker,
                bowlerId: setupPicks.bowler,
            });
            swaps.forEach((s) => {
                undoSnapshots.concat(redoSnapshots).forEach((snap) => {
                    if (snap.innings === innings && snap.team) window.BallRules.applyBall.transferBatter(snap.team, s.fromId, s.toId);
                });
            });
            redoSnapshots = []; // the server clears redo after a setup change
            scoreSetupOverlay.style.display = 'none';
            handleMatchUpdate(data.match);
        } catch (err) {
            console.error(err);
        } finally {
            isSubmitting = false;
        }
    });

    updateUndoBtn();
    // Click feedback: a button goes lighter as soon as it's tapped, and stays
    // that way briefly even if the pad redraws right after.
    document.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('button, .score-pad-backbar, .ig-picker-item');
        if (!btn || btn.disabled) return;
        if (btn.classList.contains('score-pad-btn')) {
            btn.classList.add('score-pad-btn-pressed');
            setTimeout(() => btn.classList.remove('score-pad-btn-pressed'), 320);
        }
        btn.classList.add('is-pressed');
        setTimeout(() => btn.classList.remove('is-pressed'), 300);
    });

    // A new innings that still needs its players: the pad is replaced by a Set
    // Players button and the popup opens here, so no other page has to load.
    function showPadOrSetup(isSetUp) {
        [scorePadHeader, scorePadGrid].forEach((el) => { el.style.display = isSetUp ? '' : 'none'; });
        document.getElementById('setPlayersBtn').style.display = isSetUp ? 'none' : 'flex';
        if (!isSetUp) openSetupForm();
    }
    document.getElementById('setPlayersBtn').addEventListener('click', openSetupForm);

    updateEditablePlayers();
    renderScorePad();
    restorePendingScore();

    function promptNextBowler() {
        const cancelBtn = document.getElementById('cancelCardPicker');
        const closeBtn = cardPickerCloseBtn;
        cancelBtn.style.display = 'none';
        closeBtn.style.display = 'none';
        const pool = team.bowling;
        openCardPicker(pool, "Select Next Over's Bowler", async (id) => {
            try {
                flushBallQueue();
                await requestChain;
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
