import { createPortal } from "react-dom";

export default function ConfirmModal({ open, title, message, confirmLabel, icon, onCancel, onConfirm, busy }) {
  if (!open) return null;
  return createPortal(
    <div className="confirm-overlay confirm-overlay-visible" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-modal">
        <h2 className="add-player-title">{title}</h2>
        <p>{message}</p>
        <div className="confirm-actions">
          <button type="button" className="toolbar-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="toolbar-btn toolbar-btn-danger" onClick={onConfirm} disabled={busy}>
            <i className={`fa-solid ${icon}`} />
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}