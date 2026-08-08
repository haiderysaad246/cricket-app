// Server-side port of public/js/mvp.js's CricHeroes-style MVP Points
// system. Kept logically identical to the client version (same rules,
// same math) so a match's MVP leaderboard is the same whether it's
// rendered live in the browser or computed here to award Match/Turf MVP.
// See public/js/mvp.js for the full rules writeup.

function bracket(overs, table, fallback) {
    for (const [max, val] of table) if (overs <= max) return val;
    return fallback;
}

const baseRunsPerWicket = (overs) => bracket(overs, [
    [7, 12], [12, 14], [16, 16], [20, 18], [26, 20], [40, 22], [50, 25],
], 27);

const maidensPerWicket = (overs) => bracket(overs, [
    [7, 1], [12, 2], [16, 2], [20, 2], [26, 2], [40, 3], [50, 3],
], 6);

const srBonusPct = (overs) => bracket(overs, [[20, 0.08], [35, 0.06], [50, 0.04]], 0.02);

const orderMultiplier = (position) => (position <= 4 ? 1.0 : position <= 8 ? 0.8 : 0.6);

function parseDismissal(text, fieldingRoster) {
    const findByName = (name) => fieldingRoster.find((r) => r.name === name) || null;
    if (!text || text === "Retired Out" || text === "Obstructing the Field") return {};

    const runoutMatch = text.match(/^Run Out(?: \((.+)\))?$/);
    if (runoutMatch) {
        const fielder = runoutMatch[1] ? findByName(runoutMatch[1]) : null;
        return { fielderId: fielder ? fielder.id : null, fielderFullCredit: true };
    }

    const bowlerMatch = text.match(/ b (.+?)(?: \(Wide\))?$/);
    const bowler = bowlerMatch ? findByName(bowlerMatch[1]) : null;
    const result = { bowlerId: bowler ? bowler.id : null };

    if (text.startsWith("c ")) {
        const m = text.match(/^c (.+?) b /);
        const fielder = m ? findByName(m[1]) : null;
        if (fielder) { result.fielderId = fielder.id; result.fielderFullCredit = false; }
    } else if (text.startsWith("St. ")) {
        const m = text.match(/^St\. (.+?) b /);
        const fielder = m ? findByName(m[1]) : null;
        if (fielder) { result.fielderId = fielder.id; result.fielderFullCredit = false; }
    }
    return result;
}

// NOTE: bucket keys everything by String(id) (unlike the client version,
// which already deals in plain string ids from JSON) since mongoose
// ObjectId instances aren't reference-equal across separate lookups.
function computeMVP(match) {
    const players = new Map();
    const bucket = (id, name, image, isCaptain, teamName) => {
        const key = String(id);
        if (!players.has(key)) {
            players.set(key, { id: key, name, image, isCaptain, teamName, battingPts: 0, bowlingPts: 0, fieldingPts: 0 });
        }
        return players.get(key);
    };

    ["team1", "team2"].forEach((teamKey) => {
        const team = match[teamKey];
        const overs = match.overs;
        const teamSR = team.legalBalls > 0 ? (team.totalRuns / team.legalBalls) * 100 : 0;
        const srPct = srBonusPct(overs);
        const baseWkt = baseRunsPerWicket(overs);
        const maidensPerWkt = maidensPerWicket(overs);

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

        team.batting.forEach((row, idx) => {
            if (row.status !== "out" || !row.dismissalText) return;
            const position = row.battingOrder != null ? row.battingOrder : idx + 1;
            const wicketPts = (baseWkt * orderMultiplier(position)) / 10;
            const { bowlerId, fielderId, fielderFullCredit } = parseDismissal(row.dismissalText, team.bowling);

            if (bowlerId) {
                const bowlerRow = team.bowling.find((r) => r.id === bowlerId);
                const p = bucket(bowlerId, bowlerRow.name, bowlerRow.image, bowlerRow.isCaptain, teamKey === "team1" ? match.team2.name : match.team1.name);
                p.bowlingPts += wicketPts;
            }
            if (fielderId) {
                const fielderRow = team.bowling.find((r) => r.id === fielderId);
                const p = bucket(fielderId, fielderRow.name, fielderRow.image, fielderRow.isCaptain, teamKey === "team1" ? match.team2.name : match.team1.name);
                p.fieldingPts += fielderFullCredit ? wicketPts : wicketPts * 0.2;
            }
        });

        team.bowling.forEach((row) => {
            if (!row.balls && !row.wickets && !row.maidens) return;
            const p = bucket(row.id, row.name, row.image, row.isCaptain, teamKey === "team1" ? match.team2.name : match.team1.name);

            if (row.wickets >= 10) p.bowlingPts += 1.5;
            else if (row.wickets >= 5) p.bowlingPts += 1.0;
            else if (row.wickets >= 3) p.bowlingPts += 0.5;

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

module.exports = { computeMVP };