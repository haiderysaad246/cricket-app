// CricHeroes-style MVP Points system.
// Implements only the CURRENT (post-update) rules from the spec:
//  - No Par Score Bonus (removed) for batters, bowlers or fielders.
//  - SR Bonus is reward-only, never a penalty (0 instead of negative).
//  - No 10%-per-extra-wicket bonus (deprecated); only 3/5/10 wicket
//    milestones (highest one only) apply.
//  - Assisted wickets (catch/stump): bowler gets full points, fielder/
//    keeper gets an extra 20% of that wicket's points.
//  - Unassisted wickets (bowled/lbw/hit-wicket): bowler gets full points.
//  - Run out: full wicket points go to the credited fielder, nothing to
//    a bowler (matches how the app itself never increments bowler.wickets
//    on a run out).
// NOTE: the underlying data model only stores a free-text dismissalText
// (e.g. "c John b Mike", "St. Keeper b Mike", "Run Out (John)"), so wicket
// type / fielder is parsed from that string.

(function () {
    function bracket(overs, table, fallback) {
        for (const [max, val] of table) if (overs <= max) return val;
        return fallback;
    }

    // Base runs per wicket, by match overs.
    const baseRunsPerWicket = (overs) => bracket(overs, [
        [7, 12], [12, 14], [16, 16], [20, 18], [26, 20], [40, 22], [50, 25],
    ], 27);

    // Maiden overs treated as the equivalent of one wicket.
    const maidensPerWicket = (overs) => bracket(overs, [
        [7, 1], [12, 2], [16, 2], [20, 2], [26, 2], [40, 3], [50, 3],
    ], 6);

    // SR Bonus percentage (used for both batting and bowling SR bonus).
    const srBonusPct = (overs) => bracket(overs, [[20, 0.08], [35, 0.06], [50, 0.04]], 0.02);

    const orderMultiplier = (position) => (position <= 4 ? 1.0 : position <= 8 ? 0.8 : 0.6);

    function parseDismissal(text, fieldingRoster) {
        // Returns { bowlerId, fielderId, fielderShare } — any of these may be null.
        const findByName = (name) => fieldingRoster.find((r) => r.name === name) || null;
        if (!text || text === 'Retired Out' || text === 'Obstructing the Field') return {};

        const runoutMatch = text.match(/^Run Out(?: \((.+)\))?$/);
        if (runoutMatch) {
            const fielder = runoutMatch[1] ? findByName(runoutMatch[1]) : null;
            return { fielderId: fielder ? fielder.id : null, fielderFullCredit: true };
        }

        const bowlerMatch = text.match(/ b (.+?)(?: \(Wide\))?$/);
        const bowler = bowlerMatch ? findByName(bowlerMatch[1]) : null;
        const result = { bowlerId: bowler ? bowler.id : null };

        if (text.startsWith('c ')) {
            const m = text.match(/^c (.+?) b /);
            const fielder = m ? findByName(m[1]) : null;
            if (fielder) { result.fielderId = fielder.id; result.fielderFullCredit = false; }
        } else if (text.startsWith('St. ')) {
            const m = text.match(/^St\. (.+?) b /);
            const fielder = m ? findByName(m[1]) : null;
            if (fielder) { result.fielderId = fielder.id; result.fielderFullCredit = false; }
        }
        return result;
    }

    function computeMVP(match) {
        const players = new Map(); // id -> stat bucket
        const bucket = (id, name, image, isCaptain, teamName) => {
            if (!players.has(id)) {
                players.set(id, { id, name, image, isCaptain, teamName, battingPts: 0, bowlingPts: 0, fieldingPts: 0 });
            }
            return players.get(id);
        };

        ['team1', 'team2'].forEach((teamKey) => {
            const team = match[teamKey]; // this team batted; team.bowling holds the opponents who bowled at them
            const overs = match.overs;
            const teamSR = team.legalBalls > 0 ? (team.totalRuns / team.legalBalls) * 100 : 0;
            const srPct = srBonusPct(overs);
            const baseWkt = baseRunsPerWicket(overs);
            const maidensPerWkt = maidensPerWicket(overs);

            // --- Batting MVP ---
            team.batting.forEach((row) => {
                const p = bucket(row.id, row.name, row.image, row.isCaptain, team.name);
                const basic = row.runs / 10;
                let sr = 0;
                if (row.balls > 0 && teamSR > 0) {
                    const playerSR = (row.runs / row.balls) * 100;
                    if (playerSR >= teamSR) sr = (playerSR / teamSR) * srPct * basic;
                }
                p.battingPts += basic + sr;
            });

            // --- Wickets: base points by the dismissed batter's position ---
            team.batting.forEach((row, idx) => {
                if (row.status !== 'out' || !row.dismissalText) return;
                const position = row.battingOrder != null ? row.battingOrder : idx + 1;
                const wicketPts = (baseWkt * orderMultiplier(position)) / 10;
                const { bowlerId, fielderId, fielderFullCredit } = parseDismissal(row.dismissalText, team.bowling);

                if (bowlerId) {
                    const bowlerRow = team.bowling.find((r) => r.id === bowlerId);
                    const p = bucket(bowlerId, bowlerRow.name, bowlerRow.image, bowlerRow.isCaptain, teamKey === 'team1' ? match.team2.name : match.team1.name);
                    p.bowlingPts += wicketPts;
                }
                if (fielderId) {
                    const fielderRow = team.bowling.find((r) => r.id === fielderId);
                    const p = bucket(fielderId, fielderRow.name, fielderRow.image, fielderRow.isCaptain, teamKey === 'team1' ? match.team2.name : match.team1.name);
                    p.fieldingPts += fielderFullCredit ? wicketPts : wicketPts * 0.2;
                }
            });

            // --- Milestones, SR bonus, maiden bonus for every bowler who bowled ---
            team.bowling.forEach((row) => {
                if (!row.balls && !row.wickets && !row.maidens) return;
                const p = bucket(row.id, row.name, row.image, row.isCaptain, teamKey === 'team1' ? match.team2.name : match.team1.name);

                if (row.wickets >= 10) p.bowlingPts += 1.5;
                else if (row.wickets >= 5) p.bowlingPts += 1.0;
                else if (row.wickets >= 3) p.bowlingPts += 0.5;

                // True ICC bowling strike rate = balls bowled / wickets taken
                // (lower is better — fewer balls needed per wicket). Compared
                // against the team's overall bowling strike rate for the
                // innings. A bowler who took no wickets has no defined
                // strike rate, so they simply don't qualify for this bonus.
                const teamBowlSR = team.wickets > 0 ? team.legalBalls / team.wickets : 0;
                if (row.wickets > 0 && teamBowlSR > 0) {
                    const playerSR = row.balls / row.wickets;
                    if (teamBowlSR - playerSR >= 0) {
                        p.bowlingPts += (teamBowlSR / playerSR) * (teamBowlSR - playerSR) * srPct;
                    }
                }
                if (row.maidens > 0) {
                    p.bowlingPts += (row.maidens / maidensPerWkt) * (baseWkt / 10);
                }
            });
        });

        return Array.from(players.values())
            .map((p) => ({ ...p, totalPts: p.battingPts + p.bowlingPts + p.fieldingPts }))
            .sort((a, b) => b.totalPts - a.totalPts);
    }

    function pickTrophies(match, ranked) {
        if (!match.result || !match.winnerKey) return { potm: null, fotm: null };
        const winnerName = match[match.winnerKey].name;
        const top3 = ranked.slice(0, 3);
        let potm = top3.find((p) => p.teamName === winnerName) || ranked[0] || null;
        let fotm = top3.find((p) => p.teamName !== winnerName && (!potm || p.id !== potm.id)) || null;
        return { potm, fotm };
    }

    function fmt(n) { return n.toFixed(2); }

    function renderTrophyCard(label, iconClass, player) {
        if (!player) return '';
        return `
            <div class="mvp-trophy-card">
                <i class="fa-solid ${iconClass} mvp-trophy-icon"></i>
                <div class="mvp-trophy-info">
                    <span class="mvp-trophy-label">${label}</span>
                    <span class="mvp-trophy-name">${player.name} <span class="mvp-trophy-team">(${player.teamName})</span></span>
                    <span class="mvp-trophy-pts">${fmt(player.totalPts)} pts</span>
                </div>
            </div>`;
    }

    function render(match) {
        const el = document.getElementById('mvpPanelContent');
        if (!el) return;

        const ranked = computeMVP(match);
        const { potm, fotm } = pickTrophies(match, ranked);

        let html = '';
        if (potm || fotm) {
            html += `<div class="mvp-trophies">${renderTrophyCard('Player of the Match', 'fa-trophy', potm)}${renderTrophyCard('Fighter of the Match', 'fa-fire', fotm)}</div>`;
        }

        html += `
            <div class="scorecard-block">
                <h3 class="scorecard-section-title">MVP Leaderboard</h3>
                <div class="scorecard-table-wrap">
                    <table class="scorecard-table">
                        <thead>
                            <tr>
                                <th class="col-player">Player</th>
                                <th>Bat</th>
                                <th>Bowl</th>
                                <th>Field</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ranked.map((p, i) => `
                                <tr>
                                    <td class="col-player">
                                        <span class="mvp-rank">${i + 1}</span>
                                        <span class="scorecard-pic-wrap">
                                            <img src="${p.image}" alt="${p.name}" class="scorecard-pic" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';">
                                        </span>
                                        <div class="scorecard-player-info">
                                            <span class="scorecard-player-name">${p.name}</span>
                                            <span class="scorecard-player-status">${p.teamName}</span>
                                        </div>
                                    </td>
                                    <td>${fmt(p.battingPts)}</td>
                                    <td>${fmt(p.bowlingPts)}</td>
                                    <td>${fmt(p.fieldingPts)}</td>
                                    <td class="mvp-total">${fmt(p.totalPts)}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;

        el.innerHTML = html;
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!window.MATCH) return;
        render(window.MATCH);
    });

    window.CricketMVP = { computeMVP };
})();