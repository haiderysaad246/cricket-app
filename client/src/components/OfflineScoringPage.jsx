import { useCallback, useEffect, useState } from "react";
import { Network } from "@capacitor/network";
import {
  getAppSetting,
  getDownloadedMatch,
  getDownloadedMatches,
  getOfflineCatalog,
  getPendingScoreActions,
  markScoreActionsSynced,
  saveOfflineCatalog,
  saveOfflineMatchCreation,
  saveDownloadedMatch,
  saveOfflineAction,
  setAppSetting,
  undoLastOfflineAction,
} from "../offline/offlineDatabase";
import {
  createOfflineMatchId,
  createOfflineTclMatch,
  createTurfMatch,
} from "../offline/offlineMatchFactory";

const API_ROOT_KEY = "api_root";
const TOKEN_KEY = "admin_token";

function normalizeApiRoot(value) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:") {
    throw new Error("Use the secure HTTPS address of your existing website.");
  }
  return parsed.origin;
}

function cloneMatch(match) {
  return JSON.parse(JSON.stringify(match));
}

function playerLabel(player) {
  return player?.name || "Unknown player";
}

function expectedMatchState(match, innings) {
  const team = match[innings];
  return {
    innings,
    legalBalls: team.legalBalls || 0,
    totalRuns: team.totalRuns || 0,
    wickets: team.wickets || 0,
    wicketLimit: team.wicketLimit || 0,
    strikerId: team.strikerId || null,
    nonStrikerId: team.nonStrikerId || null,
    currentBowlerId: team.currentBowlerId || null,
  };
}

export default function OfflineScoringPage() {
  const [apiRoot, setApiRoot] = useState("");
  const [token, setToken] = useState("");
  const [reauthToken, setReauthToken] = useState("");
  const [password, setPassword] = useState("");
  const [liveMatches, setLiveMatches] = useState([]);
  const [downloadedMatches, setDownloadedMatches] = useState([]);
  const [offlineCatalog, setOfflineCatalog] = useState(null);
  const [newMatchKind, setNewMatchKind] = useState("turf");
  const [match, setMatch] = useState(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dismissalOpen, setDismissalOpen] = useState(false);
  const [extraDialog, setExtraDialog] = useState("");
  const [showBowlerPicker, setShowBowlerPicker] = useState(false);

  const refreshDownloaded = useCallback(async () => {
    setDownloadedMatches(await getDownloadedMatches());
  }, []);

  const downloadOfflineCatalog = async () => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const catalog = await fetchApi(apiRoot, token, "/api/mobile/catalog");
      await saveOfflineCatalog(catalog);
      setOfflineCatalog(catalog);
      await refreshDownloaded();
      setNotice("Players, teams, Turf sessions, TCL tournaments, and match records are saved on this device.");
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  const fetchApi = useCallback(async (root, accessToken, path, options = {}) => {
    let response;
    try {
      response = await fetch(`${root}${path}`, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...options.headers,
        },
      });
      setOnline(true);
    } catch (err) {
      setOnline(false);
      throw err;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getAppSetting(API_ROOT_KEY), getAppSetting(TOKEN_KEY), getDownloadedMatches(), getOfflineCatalog(), Network.getStatus()])
      .then(([savedRoot, savedToken, savedMatches, savedCatalog, status]) => {
        if (!active) return;
        setApiRoot(savedRoot);
        setToken(savedToken);
        setDownloadedMatches(savedMatches);
        setOfflineCatalog(savedCatalog);
        setOnline(status.connected);
      })
      .catch((err) => {
        if (active) setError(`Could not open local match storage: ${err.message}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const listener = Network.addListener("networkStatusChange", (status) => setOnline(status.connected));
    return () => {
      active = false;
      listener.then((handle) => handle.remove()).catch((err) => console.error("network_listener_remove_failed", err));
    };
  }, []);

  const refreshLiveMatches = useCallback(async (root = apiRoot, accessToken = token) => {
    if (!root || !accessToken) return;
    setWorking(true);
    setError("");
    try {
      const data = await fetchApi(root, accessToken, "/api/mobile/matches");
      setLiveMatches(data.matches || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }, [apiRoot, fetchApi, token]);

  useEffect(() => {
    if (online && apiRoot && token) refreshLiveMatches();
  }, [online, apiRoot, token, refreshLiveMatches]);

  const login = async (event) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const root = normalizeApiRoot(apiRoot);
      const data = await fetchApi(root, reauthToken, "/api/mobile/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      await setAppSetting(API_ROOT_KEY, root);
      await setAppSetting(TOKEN_KEY, data.token);
      setApiRoot(root);
      setToken(data.token);
      setReauthToken("");
      setPassword("");
      setNotice("Signed in. Download a live match while online before scoring offline.");
      await refreshLiveMatches(root, data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  const signInAgain = async () => {
    setReauthToken(token);
    setToken("");
    setLiveMatches([]);
    setError("");
    setNotice("Sign in again when you have an internet connection.");
  };

  const downloadMatch = async (matchId) => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const data = await fetchApi(apiRoot, token, `/api/mobile/matches/${encodeURIComponent(matchId)}`);
      await saveDownloadedMatch(data.match);
      await refreshDownloaded();
      setNotice("Match downloaded to this device.");
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  const createOfflineMatch = async (event) => {
    event.preventDefault();
    if (!offlineCatalog) {
      setError("Download all app data while connected before creating a match offline.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const actionId = globalThis.crypto?.randomUUID?.();
    if (!actionId) {
      setError("This device cannot create a safe offline action ID.");
      return;
    }
    try {
      const matchId = createOfflineMatchId();
      const allKnownMatches = [
        ...offlineCatalog.matches,
        ...downloadedMatches.map((entry) => entry.match),
      ];
      const knownMatches = [...new Map(allKnownMatches.map((known) => [String(known._id), known])).values()];
      let createdMatch;
      let payload;
      if (newMatchKind === "turf") {
        const turfId = String(form.get("turfId") || "");
        const turf = offlineCatalog.turfs.find((entry) => String(entry._id) === turfId);
        createdMatch = createTurfMatch(turf, offlineCatalog.players, knownMatches, matchId);
        payload = { type: "create_turf_match", clientMatchId: matchId, turfId };
      } else {
        const tournamentId = String(form.get("tournamentId") || "");
        const tournament = offlineCatalog.tournaments.find((entry) => String(entry._id) === tournamentId);
        const team1Id = String(form.get("team1Id") || "");
        const team2Id = String(form.get("team2Id") || "");
        const team1 = offlineCatalog.teams.find((entry) => String(entry._id) === team1Id);
        const team2 = offlineCatalog.teams.find((entry) => String(entry._id) === team2Id);
        const fixtureCount = knownMatches.filter((entry) =>
          String(entry.tournamentId || "") === tournamentId && (entry.stage || "fixture") === "fixture"
        ).length;
        if (tournament?.totalFixtures && fixtureCount >= tournament.totalFixtures) {
          throw new Error("This TCL tournament has reached its fixture limit.");
        }
        createdMatch = createOfflineTclMatch(
          tournament,
          team1,
          team2,
          String(form.get("battingFirst") || "team1"),
          matchId
        );
        payload = { type: "create_tcl_match", clientMatchId: matchId, tournamentId, team1Id, team2Id, battingFirst: createdMatch.battingFirst };
      }
      await saveOfflineMatchCreation(createdMatch, actionId, payload);
      setMatch(createdMatch);
      setError("");
      setNotice("Match created on this device. Score offline, then tap Sync to upload it.");
      await refreshDownloaded();
    } catch (err) {
      setError(`Could not create the match offline: ${err.message}`);
    }
  };

  const openDownloadedMatch = async (matchId) => {
    setError("");
    setNotice("");
    try {
      const localMatch = await getDownloadedMatch(matchId);
      if (!localMatch) throw new Error("This match is no longer stored on this device.");
      setMatch(localMatch);
    } catch (err) {
      setError(err.message);
    }
  };

  const recordAction = async (payload) => {
    if (match?.status !== "live") {
      setError("This match is completed. Sync any pending scores to the server.");
      return;
    }
    const team = match?.[match.currentInnings];
    if (!match || !team?.strikerId || !team?.nonStrikerId || !team?.currentBowlerId) {
      setError("Set the two batters and bowler for this innings first.");
      return;
    }
    if (team.legalBalls > 0 && team.legalBalls % 6 === 0) {
      setError("Choose the next bowler before scoring this over.");
      return;
    }
    setError("");
    setNotice("");
    const actionId = globalThis.crypto?.randomUUID?.();
    if (!actionId) {
      setError("This device cannot create a safe offline action ID. Update Android System WebView and try again.");
      return;
    }
    const fullPayload = {
      innings: match.currentInnings,
      clientExpectedState: expectedMatchState(match, match.currentInnings),
      ...payload,
    };
    const predicted = cloneMatch(match);
    const result = window.BallRules?.applyBall(predicted, match.currentInnings, fullPayload);
    if (!result?.ok) {
      setError(`Could not record score: ${result?.error || "scoring rules are unavailable"}.`);
      return;
    }
    try {
      await saveOfflineAction(match._id, actionId, fullPayload, predicted, match);
      setMatch(predicted);
      await refreshDownloaded();
    } catch (err) {
      setError(`Score was not saved locally: ${err.message}`);
    }
  };

  const setupCurrentInnings = async (event) => {
    event.preventDefault();
    const activeTeam = match?.[match.currentInnings];
    const opposingTeam = match && match.currentInnings
      ? match[match.currentInnings === "team1" ? "team2" : "team1"]
      : null;
    if (!match || !activeTeam || !opposingTeam) return;
    const form = new FormData(event.currentTarget);
    const strikerId = String(form.get("strikerId") || "");
    const nonStrikerId = String(form.get("nonStrikerId") || "");
    const bowlerId = String(form.get("bowlerId") || "");
    if (!strikerId || !nonStrikerId || !bowlerId || strikerId === nonStrikerId) {
      setError("Choose two different batters and a bowler.");
      return;
    }
    const actionId = globalThis.crypto?.randomUUID?.();
    if (!actionId) {
      setError("This device cannot create a safe offline action ID.");
      return;
    }
    const setupPayload = {
      innings: match.currentInnings,
      clientExpectedState: expectedMatchState(match, match.currentInnings),
      strikerId,
      nonStrikerId,
      bowlerId,
    };
    const updated = cloneMatch(match);
    const team = updated[updated.currentInnings];
    team.strikerId = strikerId;
    team.nonStrikerId = nonStrikerId;
    team.currentBowlerId = bowlerId;
    let nextBattingOrder = Math.max(0, ...team.batting.map((player) => Number(player.battingOrder) || 0)) + 1;
    for (const id of [strikerId, nonStrikerId]) {
      const row = team.batting.find((player) => String(player.id) === id);
      if (row) {
        row.status = "batting";
        if (row.battingOrder == null) row.battingOrder = nextBattingOrder++;
      }
    }
    try {
      await saveOfflineAction(match._id, actionId, { type: "setup", ...setupPayload }, updated, match);
      setMatch(updated);
      setError("");
      setNotice("Innings players saved on this device. Sync when you’re online.");
      await refreshDownloaded();
    } catch (err) {
      setError(`Players were not saved locally: ${err.message}`);
    }
  };

  const changeBowler = async (event) => {
    event.preventDefault();
    const team = match?.[match.currentInnings];
    const form = new FormData(event.currentTarget);
    const bowlerId = String(form.get("bowlerId") || "");
    if (!match || !team || !bowlerId) {
      setError("Choose a bowler for the next over.");
      return;
    }
    const actionId = globalThis.crypto?.randomUUID?.();
    if (!actionId) {
      setError("This device cannot create a safe offline action ID.");
      return;
    }
    const payload = {
      type: "setup",
      innings: match.currentInnings,
      clientExpectedState: expectedMatchState(match, match.currentInnings),
      bowlerId,
    };
    const updated = cloneMatch(match);
    updated[updated.currentInnings].currentBowlerId = bowlerId;
    try {
      await saveOfflineAction(match._id, actionId, payload, updated, match);
      setMatch(updated);
      setShowBowlerPicker(false);
      setError("");
      setNotice("Next bowler saved on this device. Sync when you’re online.");
      await refreshDownloaded();
    } catch (err) {
      setError(`Bowler was not saved locally: ${err.message}`);
    }
  };

  const endMatchOffline = async () => {
    if (!match || match.status !== "live") return;
    const actionId = globalThis.crypto?.randomUUID?.();
    if (!actionId) {
      setError("This device cannot create a safe offline action ID.");
      return;
    }
    const updated = cloneMatch(match);
    updated.status = "completed";
    updated.result = updated.result || "No Result";
    updated.updatedAt = new Date().toISOString();
    const payload = {
      type: "end_match",
      clientExpectedState: expectedMatchState(match, match.currentInnings),
    };
    try {
      await saveOfflineAction(match._id, actionId, payload, updated, match);
      setMatch(updated);
      setError("");
      setNotice("Match ending saved on this device. Sync to publish it.");
      await refreshDownloaded();
    } catch (err) {
      setError(`Match ending was not saved locally: ${err.message}`);
    }
  };

  const syncMatch = async () => {
    if (!match || !apiRoot || !token) {
      setError("Sign in to the server before syncing this match.");
      return;
    }
    setWorking(true);
    setError("");
    setNotice("");
    let syncedCount = 0;
    try {
      const pending = await getPendingScoreActions();
      let currentMatchFromServer = null;
      for (const action of pending) {
        const actionType = action.payload.type;
        const body = { ...action.payload, clientActionId: action.actionId };
        const actionMatchId = action.matchId;
        const isCreateTurfMatch = actionType === "create_turf_match";
        const isCreateTclMatch = actionType === "create_tcl_match";
        const url = isCreateTurfMatch
          ? "/api/mobile/matches/turf"
          : isCreateTclMatch
            ? `/api/mobile/tournaments/${encodeURIComponent(action.payload.tournamentId)}/matches`
            : actionType === "end_match"
              ? `/api/mobile/matches/${encodeURIComponent(actionMatchId)}/end`
            : actionType === "setup"
              ? `/api/mobile/matches/${encodeURIComponent(actionMatchId)}/setup`
              : `/api/mobile/matches/${encodeURIComponent(actionMatchId)}/ball`;
        const response = await fetchApi(apiRoot, token, url, {
          method: "POST",
          body: JSON.stringify(body),
        });
        const authoritativeMatch = response.match || null;
        if (String(authoritativeMatch?._id || "") === String(match._id)) {
          currentMatchFromServer = authoritativeMatch;
        }
        await markScoreActionsSynced([action.actionId], authoritativeMatch);
        syncedCount += 1;
      }
      const latest = currentMatchFromServer || await getDownloadedMatch(match._id);
      if (latest) setMatch(latest);
      await refreshDownloaded();
      setNotice(syncedCount ? `Synced ${syncedCount} scoring action${syncedCount === 1 ? "" : "s"}.` : "Everything is already synced.");
      await refreshLiveMatches();
    } catch (err) {
      await refreshDownloaded();
      setError(`Sync stopped after ${syncedCount} action${syncedCount === 1 ? "" : "s"}; remaining scores are still saved on this device. ${err.message}`);
    } finally {
      setWorking(false);
    }
  };

  const undoLastAction = async () => {
    if (!match) return;
    try {
      const restored = await undoLastOfflineAction(match._id);
      setMatch(restored);
      setError("");
      setNotice("Undid the latest unsynced action.");
      await refreshDownloaded();
    } catch (err) {
      setError(err.message);
    }
  };

  const recordRun = (type) => recordAction({ type });

  if (loading) {
    return <main className="offline-app"><p className="offline-muted">Opening offline storage…</p></main>;
  }

  if (match) {
    const team = match[match.currentInnings];
    const opponent = match[match.currentInnings === "team1" ? "team2" : "team1"];
    const pending = downloadedMatches.find((entry) => String(entry.match._id) === String(match._id))?.pendingCount || 0;
    const totalPending = downloadedMatches.reduce((sum, entry) => sum + entry.pendingCount, 0);
    const striker = team?.batting?.find((player) => String(player.id) === String(team.strikerId));
    const nonStriker = team?.batting?.find((player) => String(player.id) === String(team.nonStrikerId));
    const bowler = team?.bowling?.find((player) => String(player.id) === String(team.currentBowlerId));
    const bowlerDue = team?.legalBalls > 0 && team.legalBalls % 6 === 0;
    const availableBatters = (team?.batting || []).filter((player) =>
      player.status !== "out" && player.status !== "retired" &&
      ![team.strikerId, team.nonStrikerId].some((id) => id && String(id) === String(player.id))
    );

    return (
      <main className="offline-app">
        <header className="offline-header">
          <button type="button" className="offline-link-button" onClick={() => setMatch(null)}>‹ Matches</button>
          <span className={`offline-network ${online ? "is-online" : ""}`}>{online ? "Online" : "Offline"}</span>
        </header>
        <h1>{team?.name} vs {opponent?.name}</h1>
        <section className="offline-score-card">
          <div className="offline-score">{team?.totalRuns || 0}<small> / {team?.wickets || 0}</small></div>
          <div className="offline-over">Over {Math.floor((team?.legalBalls || 0) / 6)}.{(team?.legalBalls || 0) % 6} / {match.overs}</div>
          <div className="offline-player-list">
            <span><strong>{playerLabel(striker)}</strong> {striker?.runs || 0} ({striker?.balls || 0})</span>
            <span><strong>{playerLabel(nonStriker)}</strong> {nonStriker?.runs || 0} ({nonStriker?.balls || 0})</span>
            <span>Bowler: <strong>{playerLabel(bowler)}</strong> {bowler?.wickets || 0}/{bowler?.runs || 0}</span>
          </div>
        </section>

        {match.status !== "live" ? (
          <section className="offline-panel"><h2>Match completed</h2><p>Sync any pending scores to update the server.</p></section>
        ) : (!team?.strikerId || !team?.nonStrikerId || !team?.currentBowlerId) ? (
          <section className="offline-panel">
            <h2>Set up this innings</h2>
            <p>Choose the players on this device. The setup will be queued for manual sync.</p>
            <form className="offline-setup-form" onSubmit={setupCurrentInnings}>
              <label>Striker<select name="strikerId" required defaultValue=""><option value="" disabled>Select batter</option>{availableBatters.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
              <label>Non-striker<select name="nonStrikerId" required defaultValue=""><option value="" disabled>Select batter</option>{availableBatters.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
              <label>Bowler<select name="bowlerId" required defaultValue={team.currentBowlerId || ""}><option value="" disabled>Select bowler</option>{(team.bowling || []).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
              <button className="offline-primary" type="submit">Save innings setup</button>
            </form>
          </section>
        ) : (
          <section className="offline-panel">
            <h2>Record delivery</h2>
            {bowlerDue && !showBowlerPicker && (
              <button className="offline-primary offline-full-button" type="button" onClick={() => setShowBowlerPicker(true)}>
                Choose bowler for the next over
              </button>
            )}
            {showBowlerPicker && (
              <form className="offline-setup-form offline-bowler-form" onSubmit={changeBowler}>
                <label>Next over bowler<select name="bowlerId" required defaultValue="">
                  <option value="" disabled>Select bowler</option>
                  {(team.bowling || []).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                </select></label>
                <div className="offline-dialog-actions">
                  <button type="button" onClick={() => setShowBowlerPicker(false)}>Cancel</button>
                  <button className="offline-primary" type="submit">Save bowler</button>
                </div>
              </form>
            )}
            <div className="offline-run-grid">
              {[["dot", "0"], ["one", "1"], ["two", "2"], ["three", "3"], ["four", "4"], ["five", "5"], ["six", "6"]].map(([type, label]) => (
                <button type="button" key={type} onClick={() => recordRun(type)} disabled={working || bowlerDue}>{label}</button>
              ))}
            </div>
            <div className="offline-extra-grid">
              <button type="button" onClick={() => setExtraDialog("wide")} disabled={working || bowlerDue}>Wide</button>
              <button type="button" onClick={() => recordAction({ type: "wide", wideRuns: 1 })} disabled={working || bowlerDue}>Wide + run</button>
              <button type="button" onClick={() => setExtraDialog("noball")} disabled={working || bowlerDue}>No ball + runs…</button>
              <button type="button" onClick={() => recordAction({ type: "noball", noballRuns: 1 })} disabled={working || bowlerDue}>No ball + 1</button>
              <button type="button" onClick={() => recordAction({ type: "noball", noballRuns: 4, noballBoundary: "four" })} disabled={working || bowlerDue}>No ball + 4</button>
              <button type="button" onClick={() => recordAction({ type: "noball", noballRuns: 6, noballBoundary: "six" })} disabled={working || bowlerDue}>No ball + 6</button>
              <button type="button" onClick={() => setDismissalOpen(true)} disabled={working || bowlerDue}>Wicket</button>
            </div>
            <button className="offline-end-match" type="button" onClick={endMatchOffline} disabled={working}>
              End match
            </button>
          </section>
        )}

        {extraDialog && (
          <div className="offline-dialog-backdrop">
            <form className="offline-dialog" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const runs = Number(form.get("runs") || 0);
              const body = extraDialog === "wide"
                ? { type: "wide", wideRuns: runs }
                : {
                    type: "noball",
                    noballRuns: runs,
                    ...(form.get("boundary") ? { noballBoundary: String(form.get("boundary")) } : {}),
                  };
              setExtraDialog("");
              recordAction(body);
            }}>
              <h2>{extraDialog === "wide" ? "Record wide" : "Record no ball"}</h2>
              <label>{extraDialog === "wide" ? "Additional runs" : "Runs to the batter"}
                <select name="runs" defaultValue="0">{Array.from({ length: 11 }, (_, runs) => <option key={runs} value={runs}>{runs}</option>)}</select>
              </label>
              {extraDialog === "noball" && (
                <label>Boundary
                  <select name="boundary" defaultValue=""><option value="">No boundary</option><option value="four">Four</option><option value="six">Six</option></select>
                </label>
              )}
              <div className="offline-dialog-actions">
                <button type="button" onClick={() => setExtraDialog("")}>Cancel</button>
                <button className="offline-primary" type="submit">Record extra</button>
              </div>
            </form>
          </div>
        )}

        {dismissalOpen && (
          <div className="offline-dialog-backdrop">
            <form className="offline-dialog" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const outType = String(form.get("outType"));
              const outPlayerId = String(form.get("outPlayerId") || team.strikerId);
              const fielderId = String(form.get("fielderId") || "");
              const newBatsmanId = String(form.get("newBatsmanId") || "");
              if (outType === "mankad") {
                setDismissalOpen(false);
                recordAction({ type: "mankad", newBatsmanId });
                return;
              }
              if (outType === "retired") {
                setDismissalOpen(false);
                recordAction({ type: "retire", outPlayerId, newBatsmanId });
                return;
              }
              const body = {
                type: "out",
                outType,
                outPlayerId,
                newBatsmanId,
              };
              if (["catch", "stumping", "runout"].includes(outType) && fielderId) body.fielderId = fielderId;
              if (outType === "stumping" && form.get("isWide")) body.isWide = true;
              if (outType === "runout") {
                body.runoutRuns = Number(form.get("runoutRuns") || 0);
                body.isNoBall = !!form.get("isNoBall");
              }
              setDismissalOpen(false);
              recordAction(body);
            }}>
              <h2>Record wicket</h2>
              <label>Dismissal<select name="outType" defaultValue="catch">
                <option value="catch">Caught</option><option value="stumping">Stumped</option>
                <option value="bowled">Bowled</option><option value="hitwicket">Hit wicket</option>
                <option value="obstructing">Obstructing the field</option><option value="runout">Run out</option>
                <option value="mankad">Mankad run out</option><option value="retired">Retired out</option>
              </select></label>
              <label>Out batter<select name="outPlayerId" defaultValue={team.strikerId}>
                {[striker, nonStriker].filter(Boolean).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
              </select></label>
              <label>Fielder<select name="fielderId" defaultValue={opponent.bowling?.[0]?.id || ""}>
                {(opponent.bowling || []).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
              </select></label>
              <label>Next batter<select name="newBatsmanId" required defaultValue="">
                <option value="" disabled>Select batter</option>
                {availableBatters.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
              </select></label>
              <label>Run-out runs<select name="runoutRuns" defaultValue="0"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
              <label className="offline-checkbox"><input type="checkbox" name="isWide" /> Stumped off a wide</label>
              <label className="offline-checkbox"><input type="checkbox" name="isNoBall" /> Run out off a no ball</label>
              <div className="offline-dialog-actions">
                <button type="button" onClick={() => setDismissalOpen(false)}>Cancel</button>
                <button className="offline-primary" type="submit">Record wicket</button>
              </div>
            </form>
          </div>
        )}

        <section className="offline-sync-panel">
          <div><strong>{totalPending} pending</strong><small> {totalPending ? "action(s) saved on this device" : "actions to sync"}</small></div>
          <div className="offline-sync-actions">
            {!!pending && <button type="button" onClick={undoLastAction} disabled={working}>Undo</button>}
            <button className="offline-primary" type="button" onClick={syncMatch} disabled={working || !totalPending}>
              {working ? "Working…" : "Sync"}
            </button>
          </div>
        </section>
        {error && <p className="offline-error" role="alert">{error}</p>}
        {notice && <p className="offline-notice" role="status">{notice}</p>}
      </main>
    );
  }

  return (
    <main className="offline-app">
      <header className="offline-header"><span className={`offline-network ${online ? "is-online" : ""}`}>{online ? "Online" : "Offline"}</span></header>
      <h1>Cricket Scorer</h1>
      <p className="offline-muted">Sign in and download a live match while connected. Scores are stored on this device until you tap Sync.</p>
      {!token ? (
        <form className="offline-panel offline-login-form" onSubmit={login}>
          <label>Website address<input type="url" inputMode="url" placeholder="https://your-app.onrender.com" value={apiRoot} onChange={(event) => setApiRoot(event.target.value)} required /></label>
          <label>Admin password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className="offline-primary" type="submit" disabled={working}>{working ? "Signing in…" : "Sign in"}</button>
        </form>
      ) : (
        <>
          <section className="offline-panel">
            <div className="offline-section-header"><h2>Live matches</h2><button type="button" onClick={() => refreshLiveMatches()} disabled={working}>Refresh</button></div>
            <button type="button" className="offline-link-button" onClick={signInAgain}>Sign in again / change server</button>
            {!online && <p className="offline-muted">The app reports no connection. Try Refresh or Download if your internet is working.</p>}
            <button className="offline-primary offline-full-button" type="button" onClick={downloadOfflineCatalog} disabled={working}>
              {working ? "Downloading…" : "Download all app data"}
            </button>
            {offlineCatalog && (
              <p className="offline-muted">
                Saved locally: {offlineCatalog.players.length} players, {offlineCatalog.teams.length} teams, {offlineCatalog.turfs.length} Turf sessions, {offlineCatalog.tournaments.length} TCL tournaments, {offlineCatalog.matches.length} matches.
              </p>
            )}
            {online && !liveMatches.length && <p className="offline-muted">No live matches found.</p>}
            {liveMatches.map((live) => (
              <div className="offline-match-row" key={live._id}>
                <span><strong>{live.team1?.name}</strong> vs <strong>{live.team2?.name}</strong></span>
                <button type="button" onClick={() => downloadMatch(live._id)} disabled={working}>Download</button>
              </div>
            ))}
          </section>
          <section className="offline-panel">
            <h2>Create a match offline</h2>
            {!offlineCatalog ? (
              <p className="offline-muted">Download all app data while connected before creating a match offline.</p>
            ) : (
              <form className="offline-setup-form" onSubmit={createOfflineMatch}>
                <label>Match type
                  <select value={newMatchKind} onChange={(event) => setNewMatchKind(event.target.value)}>
                    <option value="turf">Turf session match</option>
                    <option value="tcl">TCL tournament fixture</option>
                  </select>
                </label>
                {newMatchKind === "turf" ? (
                  <label>Turf session
                    <select name="turfId" required defaultValue="">
                      <option value="" disabled>Select Turf session</option>
                      {offlineCatalog.turfs.filter((turf) => turf.status === "active").map((turf) => (
                        <option key={turf._id} value={turf._id}>{turf.name}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label>TCL tournament
                      <select name="tournamentId" required defaultValue="">
                        <option value="" disabled>Select tournament</option>
                        {offlineCatalog.tournaments.filter((tournament) => tournament.status === "active").map((tournament) => (
                          <option key={tournament._id} value={tournament._id}>{tournament.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>Team 1
                      <select name="team1Id" required defaultValue="">
                        <option value="" disabled>Select team</option>
                        {offlineCatalog.teams.map((team) => <option key={team._id} value={team._id}>{team.name}</option>)}
                      </select>
                    </label>
                    <label>Team 2
                      <select name="team2Id" required defaultValue="">
                        <option value="" disabled>Select team</option>
                        {offlineCatalog.teams.map((team) => <option key={team._id} value={team._id}>{team.name}</option>)}
                      </select>
                    </label>
                    <label>Batting first
                      <select name="battingFirst" defaultValue="team1">
                        <option value="team1">Team 1</option>
                        <option value="team2">Team 2</option>
                      </select>
                    </label>
                  </>
                )}
                <button className="offline-primary" type="submit" disabled={working}>
                  Create and score offline
                </button>
              </form>
            )}
          </section>
          <section className="offline-panel">
            <h2>On this device</h2>
            {!downloadedMatches.length && <p className="offline-muted">No downloaded matches yet.</p>}
            {downloadedMatches.map(({ match: local, pendingCount }) => (
              <button className="offline-downloaded-match" type="button" key={local._id} onClick={() => openDownloadedMatch(local._id)}>
                <span><strong>{local.team1?.name} vs {local.team2?.name}</strong><small>{local.status === "completed" ? "Completed" : `Innings: ${local.currentInnings}`} · {pendingCount} pending</small></span>
                <span>Open ›</span>
              </button>
            ))}
          </section>
        </>
      )}
      {error && <p className="offline-error" role="alert">{error}</p>}
      {notice && <p className="offline-notice" role="status">{notice}</p>}
    </main>
  );
}
