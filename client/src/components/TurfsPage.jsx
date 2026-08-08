import { useEffect, useState } from "react";
import { api } from "../api";

export default function TurfsPage() {
  const [turfs, setTurfs] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [timing, setTiming] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api.turfsIndex().then((data) => setTurfs(data.turfs)).catch(() => setTurfs([]));
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setName("");
    setDate("");
    setTiming("");
    setError(null);
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createTurf({ name, date, timing });
      if (res.error) throw new Error(res.error);
      window.location.href = "/turfs/session/" + res.turfId;
    } catch (err) {
      setError(err.message === "name_required" ? "Please enter a turf name." : "Something went wrong creating the turf.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!turfs) return <div className="players-page"><p className="no-players">Loading…</p></div>;

  return (
    <div className="players-page page-fade-in">
      <div className="players-toolbar">
        <button className="toolbar-btn toolbar-btn-primary" type="button" onClick={() => { resetForm(); setShowCreate(true); }}>
          <i className="fa-solid fa-plus" />
          <span>Create Turf</span>
        </button>
      </div>

      {!turfs.length ? (
        <p>No turfs yet. Create one to get started.</p>
      ) : (
        <div className="fixture-list">
          {turfs.map((turf) => (
            <a href={`/turfs/session/${turf._id}`} className="fixture-card" key={turf._id}>
              <div className="fixture-card-top">
                <i className="fa-solid fa-folder-open fixture-card-folder-icon" />
                <div className="fixture-card-title">{turf.name}</div>
              </div>
              {(turf.team1Name || turf.team2Name) && (
                <div className="fixture-card-teams">
                  <div className="fixture-card-team">
                    <span className="fixture-card-team-name">{turf.team1Name}</span>
                  </div>
                  <span className="fixture-card-vs">vs</span>
                  <div className="fixture-card-team">
                    <span className="fixture-card-team-name">{turf.team2Name}</span>
                  </div>
                </div>
              )}
              {turf.date && <div className="fixture-card-meta">{turf.date}</div>}
            </a>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="confirm-overlay confirm-overlay-visible" onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="confirm-modal turf-form-modal">
            <h2 className="add-player-title">Create Turf</h2>
            {error && <div className="form-error">{error}</div>}

            <form onSubmit={submitCreate} className="add-player-form">
              <div className="form-group">
                <label htmlFor="turfName">Turf Name</label>
                <input type="text" id="turfName" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div className="form-group">
                <label htmlFor="turfDate">Date</label>
                <input type="date" id="turfDate" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              <div className="form-group">
                <label htmlFor="turfTiming">Timing</label>
                <input type="time" id="turfTiming" value={timing} onChange={(e) => setTiming(e.target.value)} />
              </div>

              <div className="form-actions">
                <button type="button" className="toolbar-btn" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="toolbar-btn toolbar-btn-primary" disabled={submitting}>
                  <i className="fa-solid fa-check" />
                  <span>{submitting ? "Creating…" : "Create"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}