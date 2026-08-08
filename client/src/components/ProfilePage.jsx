import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import StatBlock from "./StatBlock";

export default function ProfilePage() {
  const { id } = useParams();
  const [player, setPlayer] = useState(null);
  const [tab, setTab] = useState("turf");

  useEffect(() => { api.getPlayer(id).then(setPlayer); }, [id]);

  if (!player) return <div className="profile-page"><p className="no-players">Loading…</p></div>;

  return (
    <div className="profile-page page-fade-in">
      <div className="profile-header">
        <Link to="/players" className="profile-back-btn" aria-label="Back to players">
          <i className="fa-solid fa-arrow-left" />
        </Link>
        <h1 className="profile-header-title">PROFILE</h1>
      </div>

      <div className="profile-pic-section">
        <div className="profile-pic-ring">
          <img
            src={player.image2 || player.image}
            alt={player.name}
            className="profile-pic"
            onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/images/placeholder-player.svg"; }}
          />
          <span className="profile-rank-badge">{player.rank || ""}</span>
        </div>
      </div>

      <div className="profile-name-row">
        <span className="profile-name">{player.name}</span>
        <span className="profile-meta">{player.handed} &middot; {player.role}</span>
        <Link to={`/players/${player._id}/edit`} className="profile-edit-link">
          <i className="fa-solid fa-pen" />
          <span>Edit Profile</span>
        </Link>
      </div>

      <div className="stats-tabs">
        <button type="button" className={`stats-tab ${tab === "turf" ? "active" : ""}`} onClick={() => setTab("turf")}>Turf</button>
        <button type="button" className={`stats-tab ${tab === "tcl" ? "active" : ""}`} onClick={() => setTab("tcl")}>TCL</button>
      </div>

      <div className="stats-section">
        <h3 className="stats-section-title">MVP Awards</h3>
        <div className="stats-grid">
          <div className="stat-item"><span className="stat-label">Match MVP</span><span className="stat-value">{player.matchMvpCount || 0}</span></div>
          <div className="stat-item"><span className="stat-label">Turf MVP</span><span className="stat-value">{player.turfMvpCount || 0}</span></div>
        </div>
      </div>

      <div className="stats-columns">
        <div className="stats-column active-panel">
          <StatBlock stats={tab === "turf" ? player.turfStats : player.tclStats} />
        </div>
      </div>
    </div>
  );
}
