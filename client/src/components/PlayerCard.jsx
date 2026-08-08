import { Link } from "react-router-dom";
import CardMenu from "./CardMenu";

export default function PlayerCard({ player, isAdmin, onDelete, style }) {
  return (
    <div className="player-card player-card-animated" style={style}>
      <Link to={`/players/${player._id}/profile`} className="player-card-link">
        <div className="player-pic-ring">
          <img
            src={player.image}
            alt={player.name}
            className="player-pic"
            onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/images/placeholder-player.svg"; }}
          />
          <span className="player-rank-badge">{player.rank || ""}</span>
        </div>
        <div className="player-info">
          <span className="player-name">{player.name}</span>
          <span className="player-meta">{player.handed} &middot; {player.role}</span>
        </div>
      </Link>

      <CardMenu label="Player options">
        <li>
          <Link className="dropdown-item" to={`/players/${player._id}/edit`}>
            <i className="fa-solid fa-pen" />
            <span>Edit</span>
          </Link>
        </li>
        {isAdmin && (
          <li>
            <button type="button" className="dropdown-item delete-item" onClick={() => onDelete(player)}>
              <i className="fa-solid fa-trash" />
              <span>Delete</span>
            </button>
          </li>
        )}
      </CardMenu>
    </div>
  );
}
