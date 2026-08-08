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

      <div className="players-grid">
        {players === null ? (
          <p className="no-players">Loading…</p>
        ) : players.length > 0 ? (
          players.map((p, i) => (
            <PlayerCard key={p._id} player={p} isAdmin={isAdmin} onDelete={setToDelete} style={{ "--stagger": i }} />
          ))
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
