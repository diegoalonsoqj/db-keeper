import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthIdentity, PermissionKey } from "@dbkeeper/shared";
import { api } from "../lib/api";

interface AuthState {
  identity: AuthIdentity | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  has: (...perms: PermissionKey[]) => boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaura la sesión existente (cookie) al cargar.
  useEffect(() => {
    api
      .get<AuthIdentity>("/auth/me")
      .then(setIdentity)
      .catch(() => setIdentity(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const id = await api.post<AuthIdentity>("/auth/login", { username, password });
    setIdentity(id);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    setIdentity(null);
  }, []);

  const has = useCallback(
    (...perms: PermissionKey[]) => {
      if (!identity) return false;
      const granted = new Set(identity.permissions);
      return perms.every((p) => granted.has(p));
    },
    [identity],
  );

  const value = useMemo<AuthState>(
    () => ({ identity, loading, login, logout, has }),
    [identity, loading, login, logout, has],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
