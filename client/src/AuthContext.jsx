import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

const AuthCtx = createContext({ isAdmin: false, refresh: () => {} });

export function AuthProvider({ children }) {
  const [isAdmin, setIsAdmin] = useState(false);

  const refresh = () => api.authStatus().then((d) => setIsAdmin(d.isAdmin)).catch(() => {});

  useEffect(() => { refresh(); }, []);

  return <AuthCtx.Provider value={{ isAdmin, refresh }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
