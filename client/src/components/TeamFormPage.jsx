import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import TeamPlayerPicker from "./TeamPlayerPicker";
import ConfirmModal from "./ConfirmModal";

export default function TeamFormPage({ mode }) {
  const isEdit = mode === "edit";
  const { id } = useParams();
  const navigate = useNavigate();

  const [allPlayers, setAllPlayers] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [name, setName] = useState("");
  const [players, setPlayers] = useState(new Map());
  const [captain, setCaptain] = useState(null);
  const [existing, setExisting] = useState(null); // current logo/roster, when editing
  const [picker, setPicker] = useState({ open: false, temp: new Map(), transfers: new Set() });
  const [transferIds, setTransferIds] = useState(new Set());
  const [pendingTransfer, setPendingTransfer] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.listPlayers().then(setAllPlayers).catch(() => setAllPlayers([])); }, []);
  useEffect(() => { api.listTeams().then(setAllTeams).catch(() => setAllTeams([])); }, []);

  const otherTeams = allTeams.filter((team) => String(team._id) !== String(id));
  const lockedOwners = new Map(
    otherTeams.flatMap((team) => team.players.map((player) => [player._id, team]))
  );
  const lockedIds = new Set(lockedOwners.keys());

  useEffect(() => {
    if (isEdit) {
      api.getTeam(id).then((t) => {
        setName(t.name);
        setPlayers(new Map(t.players.map((p) => [p._id, p])));
        setCaptain(t.captain?._id || null);
        setExisting(t);
      });
    }
  }, [id, isEdit]);

  const openPicker = () => setPicker({ open: true, temp: new Map(players), transfers: new Set(transferIds) });
  const togglePick = (player) => {
    setPicker((p) => {
      const temp = new Map(p.temp);
      const transfers = new Set(p.transfers);
      const removing = temp.has(player._id);
      removing ? temp.delete(player._id) : temp.set(player._id, player);
      if (removing) transfers.delete(player._id);
      return { ...p, temp, transfers };
    });
  };
  const confirmTransfer = () => {
    if (!pendingTransfer) return;
    setPicker((p) => {
      const temp = new Map(p.temp);
      const transfers = new Set(p.transfers);
      temp.set(pendingTransfer.player._id, pendingTransfer.player);
      transfers.add(pendingTransfer.player._id);
      return { ...p, temp, transfers };
    });
    setPendingTransfer(null);
  };
  const donePicker = () => {
    setPlayers(picker.temp);
    setTransferIds(picker.transfers);
    setCaptain((c) => (c && !picker.temp.has(c) ? null : c));
    setPicker({ open: false, temp: new Map(), transfers: new Set() });
  };
  const toggleCaptain = (playerId) => setCaptain((c) => (c === playerId ? null : playerId));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (players.size === 0) return setError("Please add at least one player to the team.");
    if (!captain) return setError("Please select a captain for the team.");

    const fd = new FormData(e.target);
    fd.delete("players");
    [...players.keys()].forEach((pid) => fd.append("players", pid));
    [...transferIds].filter((pid) => players.has(pid)).forEach((pid) => fd.append("transferPlayerIds", pid));
    fd.set("captain", captain);

    setSaving(true);
    try {
      if (isEdit) await api.updateTeam(id, fd);
      else await api.createTeam(fd);
      navigate("/teams");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && !existing) return <div className="players-page"><p className="no-players">Loading…</p></div>;

  return (
    <div className="players-page page-fade-in">
      <div className="add-player-form-wrapper form-pop-in">
        <h2 className="add-player-title">{isEdit ? "Edit Team" : "Add Team"}</h2>
        {error && <div className="form-error">{error}</div>}

        <form onSubmit={submit} className="add-player-form" encType="multipart/form-data">
          <div className="form-group">
            <label htmlFor="name">Team Name</label>
            <input type="text" name="name" id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />
          </div>

          <div className="form-group">
            <label htmlFor="logo">Team Logo</label>
            {isEdit && (
              <img
                src={existing.logo}
                alt="current logo"
                className="current-thumb"
                onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/images/placeholder-player.svg"; }}
              />
            )}
             <input type="file" name="logo" id="logo" accept="image/png, image/jpeg, image/webp" autoComplete="off" />
            <small className="form-hint">{isEdit ? "Leave empty to keep current logo. Max size 2MB." : "Optional. PNG, JPG or WEBP. Max size 2MB."}</small>
          </div>

          <div className="form-group">
            <label>Team Players</label>
            <button type="button" className="toolbar-btn team-picker-btn" onClick={openPicker}>
              <i className="fa-solid fa-plus" />
              <span>Select Players</span>
            </button>
            <p className="turf-captain-hint">Tap a player's photo to make them captain</p>
            <div className="team-selected-chips">
              {[...players.values()].map((p) => (
                <span className={`turf-player-chip ${captain === p._id ? "is-captain" : ""}`} key={p._id} title="Tap the photo to make them captain">
                  <span className="turf-chip-pic-wrap" style={{ cursor: "pointer" }} onClick={() => toggleCaptain(p._id)}>
                    <img
                      src={p.image}
                      alt={p.name}
                      onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/images/placeholder-player.svg"; }}
                    />
                    {captain === p._id && <i className="fa-solid fa-crown turf-captain-badge" />}
                  </span>
                  <span>{p.name}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="toolbar-btn" onClick={() => navigate("/teams")}>Cancel</button>
            <button type="submit" className="toolbar-btn toolbar-btn-primary" disabled={saving}>
              <i className={`fa-solid ${isEdit ? "fa-check" : "fa-plus"}`} />
              <span>{saving ? "Saving…" : isEdit ? "Save Changes" : "Add Team"}</span>
            </button>
          </div>
        </form>
      </div>

      <TeamPlayerPicker
        open={picker.open}
        title="Select Players"
        allPlayers={allPlayers}
        lockedIds={lockedIds}
        selectedIds={new Set(picker.temp.keys())}
        selectedOrder={[...picker.temp.keys()]}
        onToggle={togglePick}
        lockedOwners={lockedOwners}
        onRequestTransfer={(player, sourceTeam) => setPendingTransfer({ player, sourceTeam })}
        onCancel={() => setPicker({ open: false, temp: new Map(), transfers: new Set() })}
        onDone={donePicker}
      />
      <ConfirmModal
        open={!!pendingTransfer}
        title="Transfer Player?"
        message={`Remove ${pendingTransfer?.player.name} from ${pendingTransfer?.sourceTeam.name} and add them to ${name.trim() || "this team"}? This change will be saved when you submit the team form.`}
        confirmLabel="Transfer Player"
        icon="fa-right-left"
        onCancel={() => setPendingTransfer(null)}
        onConfirm={confirmTransfer}
      />
    </div>
  );
}