import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

export default function AuthWidget() {
  const { isAdmin, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api.login(password);
      setPassword("");
      setOpen(false);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const logout = async () => {
    await api.logout();
    refresh();
  };

  if (isAdmin) {
    return (
      <div className="auth-widget">
        <button type="button" className="auth-pill" onClick={logout}>
          <i className="fa-solid fa-user-shield" />
          <span>Admin</span>
          <i className="fa-solid fa-arrow-right-from-bracket auth-pill-logout" />
        </button>
      </div>
    );
  }

  return (
    <div className="auth-widget">
      <button type="button" className="auth-pill" onClick={() => setOpen((v) => !v)}>
        <i className="fa-solid fa-lock" />
        <span>Login</span>
      </button>
      <form className={`auth-popover ${open ? "open" : ""}`} onSubmit={submit}>
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="auth-popover-submit"><i className="fa-solid fa-arrow-right" /></button>
        <small className="auth-popover-hint">Its only for admin</small>
        {error && <small className="auth-popover-error">{error}</small>}
      </form>
    </div>
  );
}
