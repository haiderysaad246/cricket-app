import { Link } from "react-router-dom";
import CardMenu from "./CardMenu";

export default function TeamCard({ team, isAdmin, onDelete, style }) {
  return (
    <div className="player-card player-card-animated" style={style}>
      <Link to={`/teams/${team._id}`} className="player-card-link">
        <div className="player-pic-ring">
          <img
            src={team.logo}
            alt={team.name}
            className="player-pic"
            onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/images/placeholder-player.svg"; }}
          />
        </div>
        <div className="player-info">
          <span className="player-name">{team.name}</span>
          <span className="player-meta">{team.players?.length || 0} players &middot; Capt. {team.captain?.name || "—"}</span>
        </div>
      </Link>

      {isAdmin && (
        <CardMenu label="Team options">
          <li>
            <Link className="dropdown-item" to={`/teams/${team._id}/edit`}>
              <i className="fa-solid fa-pen" />
              <span>Edit</span>
            </Link>
          </li>
          <li>
            <Link className="dropdown-item" to={`/teams/${team._id}/edit`}>
            <i className="fa-solid fa-user-plus" />
            <span>Add Player</span>
            </Link>
          </li>
          <li>
            <button type="button" className="dropdown-item delete-item" onClick={() => onDelete(team)}>
              <i className="fa-solid fa-trash" />
              <span>Delete</span>
            </button>
          </li>
        </CardMenu>
      )}
    </div>
  );
}