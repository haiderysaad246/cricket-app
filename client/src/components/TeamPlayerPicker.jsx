import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function TeamPlayerPicker({ open, title, allPlayers, lockedIds, selectedIds, selectedOrder, onToggle, onCancel, onDone }) {
  const [search, setSearch] = useState("");
  useEffect(() => { if (open) setSearch(""); }, [open]);

  if (!open) return null;
  const q = search.trim().toLowerCase();
  const selectedPosition = new Map((selectedOrder || []).map((id, index) => [id, index]));
  const players = [...allPlayers].sort((a, b) => {
    const aMatches = q && (a.name || "").toLowerCase().includes(q) ? 1 : 0;
    const bMatches = q && (b.name || "").toLowerCase().includes(q) ? 1 : 0;
    if (aMatches !== bMatches) return bMatches - aMatches;

    const aSelected = selectedIds.has(a._id) ? 1 : 0;
    const bSelected = selectedIds.has(b._id) ? 1 : 0;
    if (aSelected !== bSelected) return bSelected - aSelected;
    if (aSelected && bSelected) {
      return selectedPosition.get(b._id) - selectedPosition.get(a._id);
    }
    return allPlayers.indexOf(a) - allPlayers.indexOf(b);
  });
  return createPortal(
    <div className="confirm-overlay confirm-overlay-visible" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-modal picker-modal">
                <h2 className="add-player-title">{title}</h2>

        <input
          type="text"
          className="picker-search-input"
          placeholder="Search players..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="players-grid picker-grid">
          {players.map((p) => {
            const locked = lockedIds.has(p._id);
            const selected = selectedIds.has(p._id);
            return (
              <div
                key={p._id}
                className={`player-card picker-player-card ${selected ? "picker-selected" : ""} ${locked ? "picker-disabled" : ""}`}
                onClick={() => !locked && onToggle(p)}
              >
                <div className="player-card-link">
                  <div className="player-pic-ring">
                    <img
                      src={p.image}
                      alt={p.name}
                      className="player-pic"
                      onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/images/placeholder-player.svg"; }}
                    />
                  </div>
                  <div className="player-info">
                    <span className="player-name">{p.name}</span>
                    <span className="player-meta">{p.handed} {p.role}</span>
                  </div>
                </div>
                <i className="fa-solid fa-circle-check picker-check-icon" />
              </div>
            );
          })}
        </div>

        <div className="form-actions">
          <button type="button" className="toolbar-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="toolbar-btn toolbar-btn-primary" onClick={onDone}>
            <i className="fa-solid fa-check" />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
