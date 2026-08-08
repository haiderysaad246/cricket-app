import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import TeamCard from "./TeamCard";
import ConfirmModal from "./ConfirmModal";

export default function TeamsPage() {
  const { isAdmin } = useAuth();
  const [teams, setTeams] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.listTeams().then(setTeams).catch(() => setTeams([]));
  useEffect(() => { load(); }, []);

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.deleteTeam(toDelete._id);
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
          <Link className="toolbar-btn toolbar-btn-primary" to="/teams/new">
            <i className="fa-solid fa-plus" />
            <span>Add Team</span>
          </Link>
        </div>
      )}

      <div className="players-grid">
        {teams === null ? (
          <p className="no-players">Loading…</p>
        ) : teams.length > 0 ? (
          teams.map((t, i) => (
            <TeamCard key={t._id} team={t} isAdmin={isAdmin} onDelete={setToDelete} style={{ "--stagger": i }} />
          ))
        ) : (
          <p className="no-players">No teams added yet.</p>
        )}
      </div>

      <ConfirmModal
        open={!!toDelete}
        title="Delete Team?"
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