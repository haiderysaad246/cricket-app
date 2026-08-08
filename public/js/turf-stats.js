// Aggregates every match in this turf (window.TURF_MATCHES) into
// cross-match leaderboards, shown by swapping out the matches list for
// a stat panel — same tab pattern as the live-match scorecard tabs.
// Uses event delegation on the tabs container so clicks work even if
// this script runs before/independently of other page scripts.
(function () {
    const tabsWrap = document.getElementById('turfStatTabs');
    const matchesPanel = document.getElementById('turfMatchesPanel');
    const statsPanel = document.getElementById('turfStatsPanel');
    const statsContent = document.getElementById('turfStatsContent');
    const backBtn = document.getElementById('backToMatchesBtn');
    if (!tabsWrap || !matchesPanel || !statsPanel || !statsContent) return; // not on the session page

    const matches = window.TURF_MATCHES || [];
    const fmt = (n) => (Math.round(n * 100) / 100).toString();

    function bucket(map, id, name, image) {
        const key = String(id);
        if (!map.has(key)) {
            map.set(key, {
                id: key, name, image,
                runs: 0, balls: 0, fours: 0, sixes: 0, dismissals: 0,
                wickets: 0, ballsBowled: 0, runsConceded: 0,
                catches: 0, mvpPts: 0,
            });
        }
        return map.get(key);
    }

    // Only used to credit catches: parses the free-text dismissal
    // (e.g. "c John b Mike") to find who took the catch.
    function parseCatcher(text, fieldingRoster) {
        if (!text || !text.startsWith('c ')) return null;
        const m = text.match(/^c (.+?) b /);
        if (!m) return null;
        return fieldingRoster.find((r) => r.name === m[1]) || null;
    }

    function aggregate() {
        const players = new Map();
        matches.forEach((match) => {
            ['team1', 'team2'].forEach((key) => {
                const team = match[key];
                if (!team) return;
                (team.batting || []).forEach((row) => {
                    if (row.status === 'yet_to_bat' || !row.id) return;
                    const p = bucket(players, row.id, row.name, row.image);
                    p.runs += row.runs || 0;
                    p.balls += row.balls || 0;
                    p.fours += row.fours || 0;
                    p.sixes += row.sixes || 0;
                    if (row.status === 'out') {
                        p.dismissals += 1;
                        const catcher = parseCatcher(row.dismissalText, team.bowling || []);
                        if (catcher && catcher.id) {
                            bucket(players, catcher.id, catcher.name, catcher.image).catches += 1;
                        }
                    }
                });
                (team.bowling || []).forEach((row) => {
                    if (!row.id || (!row.balls && !row.runs && !row.wickets)) return;
                    const p = bucket(players, row.id, row.name, row.image);
                    p.wickets += row.wickets || 0;
                    p.ballsBowled += row.balls || 0;
                    p.runsConceded += row.runs || 0;
                });
            });
            if (window.CricketMVP) {
                try {
                    window.CricketMVP.computeMVP(match).forEach((mp) => {
                        const p = bucket(players, mp.id, mp.name, mp.image);
                        p.mvpPts += mp.totalPts;
                    });
                } catch (e) { /* skip a malformed match rather than breaking the whole page */ }
            }
        });
        return Array.from(players.values());
    }

    // Minimum-balls qualifier for rate-based stats. A batter must face
    // a full 6-ball over and a bowler must bowl a full 6-ball over to
    // qualify, matching the maximum balls possible in a 1-over match.
    const MIN_BALLS_FACED = 6;
    const MIN_BALLS_BOWLED = 6;

    const STAT_DEFS = {
        mvp: { title: 'MVP Leaderboard', unit: 'Pts', filter: () => true, sort: (a, b) => b.mvpPts - a.mvpPts, value: (p) => fmt(p.mvpPts) },
        runs: { title: 'Most Runs', unit: 'Runs', filter: (p) => p.runs > 0, sort: (a, b) => b.runs - a.runs, value: (p) => p.runs },
        sixes: { title: 'Most Sixes', unit: 'Sixes', filter: (p) => p.sixes > 0, sort: (a, b) => b.sixes - a.sixes, value: (p) => p.sixes },
        fours: { title: 'Most Fours', unit: 'Fours', filter: (p) => p.fours > 0, sort: (a, b) => b.fours - a.fours, value: (p) => p.fours },
        wickets: { title: 'Most Wickets', unit: 'Wkts', filter: (p) => p.wickets > 0, sort: (a, b) => b.wickets - a.wickets, value: (p) => p.wickets },
        catches: { title: 'Most Catches', unit: 'Catches', filter: (p) => p.catches > 0, sort: (a, b) => b.catches - a.catches, value: (p) => p.catches },
        average: {
            title: 'Best Batting Average', unit: 'Avg',
            filter: (p) => p.dismissals > 0 && p.balls >= MIN_BALLS_FACED,
            sort: (a, b) => (b.runs / b.dismissals) - (a.runs / a.dismissals),
            value: (p) => fmt(p.runs / p.dismissals),
        },
        strikerate: {
            title: 'Best Strike Rate', unit: 'SR',
            filter: (p) => p.balls >= MIN_BALLS_FACED,
            sort: (a, b) => (b.runs / b.balls) - (a.runs / a.balls),
            value: (p) => fmt((p.runs / p.balls) * 100),
        },
        economy: {
            title: 'Best Bowling Economy', unit: 'Econ',
            filter: (p) => p.ballsBowled >= MIN_BALLS_BOWLED,
            sort: (a, b) => (a.runsConceded / (a.ballsBowled / 6)) - (b.runsConceded / (b.ballsBowled / 6)),
            value: (p) => fmt(p.runsConceded / (p.ballsBowled / 6)),
        },
    };

    function renderStat(kind) {
        const def = STAT_DEFS[kind];
        if (!def) return;
        const rows = aggregate().filter(def.filter).sort(def.sort).slice(0, 15);

        if (!rows.length) {
            statsContent.innerHTML = `<p style="text-align:center;color:#9ca3af;">No data yet for this stat.</p>`;
            return;
        }

        statsContent.innerHTML = `
            <div class="scorecard-block">
                <h3 class="scorecard-section-title">${def.title}</h3>
                <div class="scorecard-table-wrap">
                    <table class="scorecard-table">
                        <thead>
                            <tr>
                                <th class="col-player">Player</th>
                                <th>${def.unit}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map((p, i) => `
                                <tr>
                                    <td class="col-player">
                                        <span class="mvp-rank">${i + 1}</span>
                                        <span class="scorecard-pic-wrap">
                                            <img src="${p.image}" alt="${p.name}" class="scorecard-pic" onerror="this.onerror=null;this.src='/images/placeholder-player.svg';">
                                        </span>
                                        <div class="scorecard-player-info">
                                            <span class="scorecard-player-name">${p.name}</span>
                                        </div>
                                    </td>
                                    <td class="mvp-total">${def.value(p)}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
    }

    function activateTab(tab) {
        tabsWrap.querySelectorAll('.turf-stat-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        const kind = tab.dataset.stat;
        if (kind === 'matches') {
            matchesPanel.style.display = '';
            statsPanel.style.display = 'none';
        } else {
            matchesPanel.style.display = 'none';
            statsPanel.style.display = '';
            renderStat(kind);
        }
    }

    // Delegated listener: works regardless of script load order / DOM timing.
    tabsWrap.addEventListener('click', (e) => {
        const tab = e.target.closest('.turf-stat-tab');
        if (!tab) return;
        activateTab(tab);
    });

    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const matchesTab = tabsWrap.querySelector('.turf-stat-tab[data-stat="matches"]');
            if (matchesTab) activateTab(matchesTab);
        });
    }
})();