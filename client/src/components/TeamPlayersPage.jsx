import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import ConfirmModal from "./ConfirmModal";
import CardMenu from "./CardMenu";

export default function TeamPlayersPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [team, setTeam] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.getTeam(id).then(setTeam).catch(() => setTeam(false));
  useEffect(() => { load(); }, [id]);

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.deletePlayer(toDelete._id);
      setToDelete(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  if (team === null) return <div className="players-page"><p className="no-players">Loading…</p></div>;
  if (!team) return <div className="players-page"><p className="no-players">Team not found.</p></div>;

  return (
    <div className="players-page page-fade-in">
      <div className="profile-header">
        <Link to="/teams" className="profile-back-btn" aria-label="Back to teams">
          <i className="fa-solid fa-arrow-left" />
        </Link>
        <h1 className="profile-header-title">{team.name.toUpperCase()}</h1>
      </div>

      <div className="players-grid">
        {team.players.length > 0 ? (
          team.players.map((p, i) => {
            const isCaptain = team.captain?._id === p._id;
            return (
              <div className="player-card player-card-animated" key={p._id} style={{ "--stagger": i }}>
                <Link to={`/players/${p._id}/profile`} className="player-card-link">
                  <div className="player-pic-ring">
                    <img
                      src={p.image}
                      alt={p.name}
                      className="player-pic"
                      onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/images/placeholder-player.svg"; }}
                    />
                    {isCaptain && <i className="fa-solid fa-crown turf-captain-badge" title="Captain" />}
                  </div>
                  <div className="player-info">
                    <span className="player-name">{p.name}</span>
                    <span className="player-meta">{p.handed} &middot; {p.role}</span>
                  </div>
                </Link>

                <CardMenu label="Player options">
                  <li>
                    <Link className="dropdown-item" to={`/players/${p._id}/edit`}>
                      <i className="fa-solid fa-pen" />
                      <span>Edit</span>
                    </Link>
                  </li>
                  {isAdmin && (
                    <li>
                      <button type="button" className="dropdown-item delete-item" onClick={() => setToDelete(p)}>
                        <i className="fa-solid fa-trash" />
                        <span>Delete</span>
                      </button>
                    </li>
                  )}
                </CardMenu>
              </div>
            );
          })
        ) : (
          <p className="no-players">No players in this team yet.</p>
        )}
      </div>

      <ConfirmModal
        open={!!toDelete}
        title="Delete Player?"
        message={`Are you sure you want to delete ${toDelete?.name}? This can't be undone.`}
        confirmLabel="Delete"
        icon="fa-trash"
        busy={busy}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}