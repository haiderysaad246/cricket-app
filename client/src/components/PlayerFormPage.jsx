import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";

const ROLES = ["Batsmen", "Bowler", "All Rounder"];
const HANDS = ["Right Handed", "Left Handed"];

export default function PlayerFormPage({ mode }) {
  const isEdit = mode === "edit";
  const { id } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: "", role: "", handed: "" });
  const [existing, setExisting] = useState(null); // current images, when editing
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEdit) api.getPlayer(id).then((p) => { setForm({ name: p.name, role: p.role, handed: p.handed }); setExisting(p); });
  }, [id, isEdit]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.target);
    try {
      if (isEdit) await api.updatePlayer(id, fd);
      else await api.createPlayer(fd);
      navigate("/players");
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
        <h2 className="add-player-title">{isEdit ? "Edit Player" : "Add Player"}</h2>
        {error && <div className="form-error">{error}</div>}

        <form onSubmit={submit} className="add-player-form" encType="multipart/form-data">
          <div className="form-group">
            <label htmlFor="name">Name</label>
            <input type="text" name="name" id="name" value={form.name} onChange={set("name")} autoComplete="off" required />
          </div>

          <div className="form-group">
            <label htmlFor="role">Role</label>
            <select name="role" id="role" value={form.role} onChange={set("role")} autoComplete="off" required>
              <option value="" disabled>Select role</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="handed">Batting/Bowling Hand</label>
            <select name="handed" id="handed" value={form.handed} onChange={set("handed")} autoComplete="off" required>
              <option value="" disabled>Select hand</option>
              {HANDS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="image">Main Profile Picture</label>
            {isEdit && (
              <img
                src={existing.image}
                alt="current"
                className="current-thumb"
                onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/images/placeholder-player.svg"; }}
              />
            )}
            <input type="file" name="image" id="image" accept="image/png, image/jpeg, image/webp" autoComplete="off" />
            <small className="form-hint">{isEdit ? "Leave empty to keep current image. Max size 2MB." : "Optional. Square image, min 500x500px. Max size 2MB."}</small>
          </div>

          <div className="form-group">
            <label htmlFor="image2">Alternate Picture{!isEdit && " (shown on profile)"}</label>
            {isEdit && (
              <img
                src={existing.image2}
                alt="current alternate"
                className="current-thumb"
                onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/images/placeholder-player.svg"; }}
              />
            )}
            <input type="file" name="image2" id="image2" accept="image/png, image/jpeg, image/webp" autoComplete="off" />
            <small className="form-hint">{isEdit ? "Leave empty to keep current image. Max size 2MB." : "Optional. Square image, min 500x500px. Max size 2MB."}</small>
          </div>

          <div className="form-actions">
            <button type="button" className="toolbar-btn" onClick={() => navigate("/players")}>Cancel</button>
            <button type="submit" className="toolbar-btn toolbar-btn-primary" disabled={saving}>
              <i className={`fa-solid ${isEdit ? "fa-check" : "fa-plus"}`} />
              <span>{saving ? "Saving…" : isEdit ? "Save Changes" : "Add Player"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
