function objectId() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("This device cannot create a safe offline match ID.");
  }
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function playerId(player) {
  return String(player?._id || player?.id || "");
}

function makeBattingRow(player, captainId) {
  return {
    id: playerId(player),
    name: player.name,
    image: player.image,
    isCaptain: String(captainId || "") === playerId(player),
    runs: 0,
    balls: 0,
    dots: 0,
    fours: 0,
    sixes: 0,
    status: "yet_to_bat",
    dismissalText: null,
    battingOrder: null,
  };
}

function makeBowlingRow(player, captainId) {
  return {
    id: playerId(player),
    name: player.name,
    image: player.image,
    isCaptain: String(captainId || "") === playerId(player),
    balls: 0,
    noBalls: 0,
    dots: 0,
    overs: 0,
    maidens: 0,
    runs: 0,
    wickets: 0,
    wicketStreak: 0,
    hatTrick: false,
  };
}

function makeTeamState(name, battingPlayers, bowlingPlayers, captain, bowlingCaptain) {
  const captainId = playerId(captain) || null;
  const bowlingCaptainId = playerId(bowlingCaptain) || null;
  return {
    name,
    captainId,
    captainName: captain?.name || null,
    captainImage: captain?.image2 || captain?.image || null,
    batting: battingPlayers.map((player) => makeBattingRow(player, captainId)),
    bowling: bowlingPlayers.map((player) => makeBowlingRow(player, bowlingCaptainId)),
    strikerId: null,
    nonStrikerId: null,
    currentBowlerId: null,
    currentOverBowlerId: null,
    keeperId: null,
    keeperName: null,
    legalBalls: 0,
    currentOverBalls: [],
    currentOverRuns: 0,
    overStarted: false,
    overSplit: false,
    totalRuns: 0,
    wickets: 0,
    wicketLimit: null,
    extraWides: 0,
    extraNoBalls: 0,
    endedEarly: false,
    statsAggregated: false,
  };
}

function emptyMatch(matchId, overs, battingFirst, team1, team2, extra = {}) {
  return {
    _id: matchId,
    overs,
    battingFirst,
    currentInnings: battingFirst,
    team1,
    team2,
    status: "live",
    result: null,
    winnerKey: null,
    ballEvents: [],
    lastBallSnapshotCount: 0,
    redoBallSnapshotCount: 0,
    ...extra,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createOfflineMatchId() {
  return objectId();
}

export function createTurfMatch(turf, players, previousMatches, matchId) {
  if (!turf || turf.status !== "active") throw new Error("Choose an active Turf session.");
  if (!Number.isInteger(Number(turf.overs)) || Number(turf.overs) < 1) {
    throw new Error("Set up the first match for this Turf online before creating another match offline.");
  }

  const matches = previousMatches
    .filter((match) => String(match.turfId || "") === String(turf._id))
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  if (matches.some((match) => match.status === "live")) {
    throw new Error("Finish or sync the current match in this Turf before creating another one.");
  }

  const findPlayers = (ids) => (ids || [])
    .map((id) => players.find((player) => playerId(player) === String(id)))
    .filter(Boolean);
  const team1Players = findPlayers(turf.team1PlayerIds);
  const team2Players = findPlayers(turf.team2PlayerIds);
  if (!team1Players.length || !team2Players.length) {
    throw new Error("Download a Turf session that already has both team rosters set up.");
  }
  const previous = matches[0];
  const battingFirst = previous?.winnerKey || turf.battingFirst || "team1";
  return emptyMatch(
    matchId,
    Number(turf.overs),
    battingFirst,
    makeTeamState(
      turf.team1Name || "Team 1",
      team1Players,
      team2Players,
      players.find((player) => playerId(player) === String(turf.team1CaptainId || "")),
      players.find((player) => playerId(player) === String(turf.team2CaptainId || ""))
    ),
    makeTeamState(
      turf.team2Name || "Team 2",
      team2Players,
      team1Players,
      players.find((player) => playerId(player) === String(turf.team2CaptainId || "")),
      players.find((player) => playerId(player) === String(turf.team1CaptainId || ""))
    ),
    { turfId: String(turf._id) }
  );
}

export function createOfflineTclMatch(tournament, team1, team2, battingFirst, matchId) {
  if (!tournament || tournament.status !== "active") throw new Error("Choose an active TCL tournament.");
  if (!team1 || !team2 || String(team1._id) === String(team2._id)) {
    throw new Error("Choose two different teams.");
  }
  if (!Number.isInteger(Number(tournament.overs)) || Number(tournament.overs) < 1) {
    throw new Error("The TCL tournament must have its overs configured.");
  }

  const team1Players = team1.players || [];
  const team2Players = team2.players || [];
  if (!team1Players.length || !team2Players.length) {
    throw new Error("Both selected teams need downloaded player rosters.");
  }

  const first = battingFirst === "team2" ? "team2" : "team1";
  return emptyMatch(
    matchId,
    Number(tournament.overs),
    first,
    makeTeamState(team1.name, team1Players, team2Players, team1.captain, team2.captain),
    makeTeamState(team2.name, team2Players, team1Players, team2.captain, team1.captain),
    {
      tournamentId: String(tournament._id),
      team1TeamId: String(team1._id),
      team2TeamId: String(team2._id),
      stage: "fixture",
      isSuperOver: false,
      superOverParentId: null,
      superOverMatchId: null,
    }
  );
}
