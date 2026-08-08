import { useEffect, useRef, useState } from "react";

export default function CardMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  useEffect(() => {
   const card = ref.current?.closest(".player-card");
   if (!card) return;
   card.classList.toggle("menu-open", open);
   return () => card.classList.remove("menu-open");
 }, [open]);

  return (
    <div className="player-menu dropdown" ref={ref}>
      <button
        className="menu-btn"
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); }}
      >
        <i className="fa-solid fa-ellipsis-vertical" />
      </button>
      <ul
        className={`dropdown-menu player-dropdown${open ? " show" : ""}`}
        onClick={() => setOpen(false)}
      >
        {children}
      </ul>
    </div>
  );
}