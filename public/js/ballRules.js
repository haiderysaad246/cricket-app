(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = { applyBall: factory() };
    } else {
        root.BallRules = { applyBall: factory() };
    }
}(typeof self !== "undefined" ? self : this, function () {
    function findRow(list, id) {
        return (list || []).find((row) => String(row.id) === String(id));
    }

    function stampBattingOrder(row, team) {
        if (!row || row.battingOrder != null) return;
        const used = (team.batting || []).map((r) => r.battingOrder).filter((n) => n != null);
        row.battingOrder = used.length ? Math.max(...used) + 1 : 1;
    }

    function inningsComplete(match, innings) {
        const team = match[innings];
        if (!team) return false;
        const wicketCap = match.isSuperOver ? 2 : (team.batting || []).length - 1;
        return team.legalBalls >= match.overs * 6
            || team.wickets >= wicketCap
            || !!team.endedEarly;
    }

    function rotateStrike(team) {
        const striker = team.strikerId;
        team.strikerId = team.nonStrikerId;
        team.nonStrikerId = striker;
    }

    function autoSwitchInnings(match) {
        if (match.currentInnings === match.battingFirst && inningsComplete(match, match.currentInnings)) {
            match.currentInnings = match.currentInnings === "team1" ? "team2" : "team1";
        }
    }

    function maybeDeclareResult(match) {
        if (match.result) return;
        const firstKey = match.battingFirst;
        const secondKey = firstKey === "team1" ? "team2" : "team1";
        if (match.currentInnings !== secondKey) return;
        const first = match[firstKey];
        const second = match[secondKey];
        const target = first.totalRuns + 1;
        const finished = second.totalRuns >= target
            || second.legalBalls >= match.overs * 6
            || second.wickets >= (match.isSuperOver ? 2 : second.batting.length - 1);
        if (!finished) return;
        if (second.totalRuns > first.totalRuns) {
            const wicketsLeft = match.isSuperOver ? 2 - second.wickets : second.batting.length - 1 - second.wickets;
            match.result = `${second.name} won by ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}`;
            match.winnerKey = secondKey;
        } else if (first.totalRuns > second.totalRuns) {
            const runs = first.totalRuns - second.totalRuns;
            match.result = `${first.name} won by ${runs} run${runs === 1 ? "" : "s"}`;
            match.winnerKey = firstKey;
        } else {
            match.result = "Match Tied";
            match.winnerKey = null;
        }
        match.status = "completed";
    }

    function applyBall(match, innings, body) {
        const team = match && match[innings];
        if (!team) return { ok: false, error: "invalid_innings" };
        const type = body && body.type;
        if (!team.overStarted) {
            team.currentOverBalls = [];
            team.currentOverRuns = 0;
            team.overStarted = true;
        }

        if (type === "retire") {
            const outRow = findRow(team.batting, body.outPlayerId);
            if (!outRow) return { ok: false, error: "invalid_player" };
            outRow.status = "retired";
            outRow.dismissalText = "Retired Out";
            team.wickets += 1;
            if (String(team.strikerId) === String(body.outPlayerId)) team.strikerId = body.newBatsmanId;
            else team.nonStrikerId = body.newBatsmanId;
            const newRow = findRow(team.batting, body.newBatsmanId);
            if (newRow && newRow.status === "yet_to_bat") {
                newRow.status = "batting";
                stampBattingOrder(newRow, team);
            }
            autoSwitchInnings(match);
            maybeDeclareResult(match);
            return { ok: true };
        }

        const striker = findRow(team.batting, team.strikerId);
        const nonStriker = findRow(team.batting, team.nonStrikerId);
        const bowler = findRow(team.bowling, team.currentBowlerId);
        if (!striker || !nonStriker || !bowler) return { ok: false, error: "players_not_set" };

        let legal = false;
        let creditedWicket = false;
        const runValues = { dot: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, one_nr: 1 };
        if (Object.prototype.hasOwnProperty.call(runValues, type)) {
            const runs = runValues[type];
            legal = true;
            striker.runs += runs;
            striker.balls += 1;
            if (!runs) { striker.dots += 1; bowler.dots += 1; }
            if (type === "four") striker.fours += 1;
            if (type === "six") striker.sixes += 1;
            team.totalRuns += runs;
            team.legalBalls += 1;
            bowler.balls += 1;
            bowler.runs += runs;
            team.currentOverBalls.push(String(runs));
            team.currentOverRuns += runs;
            if (type !== "one_nr" && runs % 2 === 1) rotateStrike(team);
        } else if (type === "runs_extra") {
            const runs = Math.max(0, Number(body.runs || 0));
            legal = true;
            striker.runs += runs;
            striker.balls += 1;
            if (!runs) { striker.dots += 1; bowler.dots += 1; }
            team.totalRuns += runs;
            team.legalBalls += 1;
            bowler.balls += 1;
            bowler.runs += runs;
            team.currentOverBalls.push(String(runs));
            team.currentOverRuns += runs;
            if (runs % 2 === 1) rotateStrike(team);
        } else if (type === "wide") {
            const wideRuns = Math.max(0, Number(body.wideRuns || 0));
            const total = 1 + wideRuns;
            team.totalRuns += total;
            team.extraWides += total;
            bowler.runs += total;
            team.currentOverBalls.push(wideRuns ? `wd+${wideRuns}` : "wd");
            team.currentOverRuns += total;
            if (wideRuns % 2 === 1) rotateStrike(team);
        } else if (type === "noball") {
            const nbRuns = Math.max(0, Number(body.noballRuns || 0));
            const boundary = body.noballBoundary === "four" || body.noballBoundary === "six";
            const total = 1 + nbRuns;
            team.totalRuns += total;
            team.extraNoBalls += 1;
            bowler.noBalls = (bowler.noBalls || 0) + 1;
            bowler.runs += total;
            striker.balls += 1;
            team.currentOverBalls.push(nbRuns ? `nb+${nbRuns}` : "nb");
            team.currentOverRuns += total;
            if (nbRuns) {
                striker.runs += nbRuns;
                if (boundary && body.noballBoundary === "four") striker.fours += 1;
                if (boundary && body.noballBoundary === "six") striker.sixes += 1;
            }
            if (!boundary && nbRuns % 2 === 1) rotateStrike(team);
        } else if (type === "out") {
            const outType = body.outType;
            team.wickets += 1;
            if (outType === "runout") {
                const runs = Math.max(0, Number(body.runoutRuns || 0));
                const noBall = !!body.isNoBall;
                const total = noBall ? runs + 1 : runs;
                if (noBall) team.extraNoBalls += 1;
                else { legal = true; team.legalBalls += 1; bowler.balls += 1; }
                team.totalRuns += total;
                bowler.runs += total;
                striker.runs += runs;
                striker.balls += 1;
                team.currentOverBalls.push(noBall ? (runs ? `nb+${runs}W` : "nb+W") : (runs ? `${runs}W` : "W"));
                team.currentOverRuns += total;
                if (runs % 2 === 1) rotateStrike(team);
                const fielder = body.fielderId ? findRow(team.bowling, body.fielderId) : null;
                const outRow = findRow(team.batting, body.outPlayerId);
                if (outRow) {
                    outRow.status = "out";
                    outRow.dismissalText = fielder ? `Run Out (${fielder.name})` : "Run Out";
                }
                if (String(team.strikerId) === String(body.outPlayerId)) team.strikerId = body.newBatsmanId;
                else team.nonStrikerId = body.newBatsmanId;
            } else {
                const wideStumping = outType === "stumping" && !!body.isWide;
                if (wideStumping) {
                    team.totalRuns += 1; team.extraWides += 1; bowler.runs += 1;
                    team.currentOverBalls.push("wd+W"); team.currentOverRuns += 1;
                } else {
                    legal = true; striker.balls += 1; team.legalBalls += 1; bowler.balls += 1;
                    team.currentOverBalls.push("W");
                }
                if (outType !== "obstructing") { bowler.wickets += 1; creditedWicket = true; }
                const outPlayerId = body.outPlayerId || team.strikerId;
                const outRow = findRow(team.batting, outPlayerId);
                if (outRow) {
                    outRow.status = "out";
                    if (outType === "catch") {
                        const fielder = body.fielderId ? findRow(team.bowling, body.fielderId) : null;
                        outRow.dismissalText = fielder ? `c ${fielder.name} b ${bowler.name}` : `Caught b ${bowler.name}`;
                    } else if (outType === "bowled") outRow.dismissalText = `Bowled b ${bowler.name}`;
                    else if (outType === "hitwicket") outRow.dismissalText = `Hit Wicket b ${bowler.name}`;
                    else if (outType === "stumping") {
                        const stumper = body.fielderId && String(body.fielderId) !== String(team.currentBowlerId)
                            ? findRow(team.bowling, body.fielderId) : null;
                        outRow.dismissalText = `St. ${stumper ? stumper.name : "Keeper"} b ${bowler.name}${wideStumping ? " (Wide)" : ""}`;
                    } else if (outType === "obstructing") outRow.dismissalText = "Obstructing the Field";
                }
                if (String(team.strikerId) === String(outPlayerId)) team.strikerId = body.newBatsmanId;
                else team.nonStrikerId = body.newBatsmanId;
            }
            const newRow = findRow(team.batting, body.newBatsmanId);
            if (newRow && newRow.status === "yet_to_bat") { newRow.status = "batting"; stampBattingOrder(newRow, team); }
        } else {
            return { ok: false, error: "invalid_ball_type" };
        }

        if (legal) {
            if (creditedWicket) {
                bowler.wicketStreak = (bowler.wicketStreak || 0) + 1;
                if (bowler.wicketStreak >= 3) bowler.hatTrick = true;
            } else bowler.wicketStreak = 0;
        }
        if (legal && team.legalBalls % 6 === 0) {
            if (team.currentOverRuns === 0 && !team.overSplit) bowler.maidens += 1;
            team.overStarted = false;
            team.overSplit = false;
            rotateStrike(team);
        }
        autoSwitchInnings(match);
        maybeDeclareResult(match);
        return { ok: true };
    }

    return applyBall;
}));
