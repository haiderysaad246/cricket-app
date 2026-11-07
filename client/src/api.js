const json = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
};

const jsonHeaders = { Accept: "application/json" };

export const api = {
  listPlayers: () => fetch("/api/players").then(json),
  getPlayer: (id) => fetch(`/api/players/${id}`).then(json),
  createPlayer: (formData) => fetch("/api/players", { method: "POST", body: formData }).then(json),
  updatePlayer: (id, formData) => fetch(`/api/players/${id}/edit`, { method: "POST", body: formData }).then(json),
  deletePlayer: (id) => fetch(`/api/players/${id}/delete`, { method: "POST" }).then(json),

  listTeams: () => fetch("/api/teams").then(json),
  getTeam: (id) => fetch(`/api/teams/${id}`).then(json),
  createTeam: (formData) => fetch("/api/teams", { method: "POST", body: formData }).then(json),
  updateTeam: (id, formData) => fetch(`/api/teams/${id}/edit`, { method: "POST", body: formData }).then(json),
  deleteTeam: (id) => fetch(`/api/teams/${id}/delete`, { method: "POST" }).then(json),

  authStatus: () => fetch("/status").then(json),
  login: (password) =>
    fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).then(json),
  logout: () => fetch("/logout", { method: "POST" }).then(json),
};
