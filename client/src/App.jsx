import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import Navbar from "./components/Navbar";
import PlayersPage from "./components/PlayersPage";
import PlayerFormPage from "./components/PlayerFormPage";
import ProfilePage from "./components/ProfilePage";
import TurfsPage from "./components/TurfsPage";
import TeamsPage from "./components/TeamsPage";
import TeamFormPage from "./components/TeamFormPage";
import TeamPlayersPage from "./components/TeamPlayersPage";

export default function App() {
  return (
    <AuthProvider>
      <Navbar />
      <Routes>
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/players/new" element={<PlayerFormPage mode="new" />} />
        <Route path="/players/:id/profile" element={<ProfilePage />} />
        <Route path="/players/:id/edit" element={<PlayerFormPage mode="edit" />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/new" element={<TeamFormPage mode="new" />} />
        <Route path="/teams/:id/edit" element={<TeamFormPage mode="edit" />} />
        <Route path="/teams/:id" element={<TeamPlayersPage />} />
        <Route path="/turfs" element={<TurfsPage />} />
      </Routes>
    </AuthProvider>
  );
}
