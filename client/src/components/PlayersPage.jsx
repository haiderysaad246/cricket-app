import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import PlayerCard from "./PlayerCard";
import ConfirmModal from "./ConfirmModal";

export default function PlayersPage() {
  const { isAdmin } = useAuth();
  const [players, setPlayers] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const load = () => api.listPlayers().then(setPlayers).catch(() => setPlayers([]));
  useEffect(() => { load(); }, []);

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

  const query = search.trim().toLowerCase();
  const filteredPlayers = players && query
    ? players.filter((p) =>
        p.name?.toLowerCase().includes(query) ||
        p.role?.toLowerCase().includes(query) ||
        p.handed?.toLowerCase().includes(query)
      )
    : players;

  return (
    <div className="players-page page-fade-in">
      {isAdmin && (
        <div className="players-toolbar">
          <Link className="toolbar-btn toolbar-btn-primary" to="/players/new">
            <i className="fa-solid fa-plus" />
            <span>Add Player</span>
          </Link>
        </div>
      )}

      {players !== null && players.length > 0 && (
        <div className="players-search">
          <i className="fa-solid fa-magnifying-glass players-search-icon" />
          <input
            type="text"
            className="players-search-input"
            placeholder="Search players by name, role, or handedness…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search players"
          />
          {search && (
            <button
              type="button"
              className="players-search-clear"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>
      )}

      <div className="players-grid">
        {players === null ? (
          <p className="no-players">Loading…</p>
        ) : filteredPlayers.length > 0 ? (
          filteredPlayers.map((p, i) => (
            <PlayerCard key={p._id} player={p} isAdmin={isAdmin} onDelete={setToDelete} style={{ "--stagger": i }} />
          ))
        ) : players.length > 0 ? (
          <p className="no-players">No players match "{search}".</p>
        ) : (
          <p className="no-players">No players added yet.</p>
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