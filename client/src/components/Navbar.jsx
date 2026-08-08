import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import AuthWidget from "./AuthWidget";

const EXTERNAL_ITEMS = [
  { href: "/tcl", icon: "fa-trophy", label: "TCL" },
]

export default function Navbar() {
  const { isAdmin } = useAuth();
  const { pathname } = useLocation();

  return (
    <>
      <AuthWidget />
      <div className="navbar-float-wrapper">
        <nav className="navbar-pill">
          {isAdmin && (
            <a className={`nav-item ${pathname.startsWith("/turfs") ? "active" : ""}`} href="/turfs">
              <i className="fa-solid fa-map-location-dot nav-icon" />
              <span className="nav-label">Turfs</span>
            </a>
          )}
          <Link className={`nav-item ${pathname.startsWith("/players") ? "active" : ""}`} to="/players">
            <i className="fa-solid fa-people-group nav-icon" />
            <span className="nav-label">Players</span>
          </Link>
          <Link className={`nav-item ${pathname.startsWith("/teams") ? "active" : ""}`} to="/teams">
            <i className="fa-solid fa-shield-halved nav-icon" />
            <span className="nav-label">Teams</span>
          </Link>
          {EXTERNAL_ITEMS.map((item) => (
            <a key={item.href} className="nav-item" href={item.href}>
              <i className={`fa-solid ${item.icon} nav-icon`} />
              <span className="nav-label">{item.label}</span>
            </a>
          ))}
          <button className="nav-item nav-more" type="button">
            <i className="fa-solid fa-ellipsis nav-icon" />
            <span className="nav-label">More</span>
          </button>
        </nav>
      </div>
    </>
  );
}
