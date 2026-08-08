import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import TeamPlayerPicker from "./TeamPlayerPicker";

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
  const [picker, setPicker] = useState({ open: false, temp: new Map() });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.listPlayers().then(setAllPlayers).catch(() => setAllPlayers([])); }, []);
  useEffect(() => { api.listTeams().then(setAllTeams).catch(() => setAllTeams([])); }, []);

  // Players already rostered on some OTHER team — can't be picked here.
  const lockedIds = new Set(
    allTeams
      .filter((t) => t._id !== id)
      .flatMap((t) => t.players.map((p) => p._id))
  );

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

  const openPicker = () => setPicker({ open: true, temp: new Map(players) });
  const togglePick = (player) => {
    setPicker((p) => {
      const temp = new Map(p.temp);
      temp.has(player._id) ? temp.delete(player._id) : temp.set(player._id, player);
      return { ...p, temp };
    });
  };
  const donePicker = () => {
    setPlayers(picker.temp);
    setCaptain((c) => (c && !picker.temp.has(c) ? null : c));
    setPicker({ open: false, temp: new Map() });
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
        onToggle={togglePick}
        onCancel={() => setPicker({ open: false, temp: new Map() })}
        onDone={donePicker}
      />
    </div>
  );
}