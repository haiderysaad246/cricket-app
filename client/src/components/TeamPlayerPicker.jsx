import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function TeamPlayerPicker({ open, title, allPlayers, lockedIds, selectedIds, onToggle, onCancel, onDone }) {
  const [search, setSearch] = useState("");
  useEffect(() => { if (open) setSearch(""); }, [open]);

  if (!open) return null;
  const q = search.trim().toLowerCase();
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
          {allPlayers.filter((p) => !q || (p.name || "").toLowerCase().includes(q)).map((p) => {
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
