import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AuthIdentity, PermissionKey } from "@dbkeeper/shared";
import { api } from "../lib/api";
import { useTheme, type Theme } from "../theme/ThemeContext";

export interface ProfilePayload {
  fullName?: string | null;
  email?: string | null;
  preferredLanguage?: string | null;
  preferredTheme?: Theme | null;
  avatar?: string | null;
}

interface AuthState {
  identity: AuthIdentity | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  has: (...perms: PermissionKey[]) => boolean;
  updateProfile: (payload: ProfilePayload) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const { setTheme } = useTheme();
  const { i18n } = useTranslation();

  /** Aplica las preferencias del usuario (idioma/tema) a la sesión. */
  const applyPreferences = useCallback(
    (id: AuthIdentity | null) => {
      if (!id) return;
      if (id.user.preferredTheme) setTheme(id.user.preferredTheme);
      if (id.user.preferredLanguage && id.user.preferredLanguage !== i18n.language) {
        void i18n.changeLanguage(id.user.preferredLanguage);
      }
    },
    [setTheme, i18n],
  );

  useEffect(() => {
    api
      .get<AuthIdentity>("/auth/me")
      .then((id) => {
        setIdentity(id);
        applyPreferences(id);
      })
      .catch(() => setIdentity(null))
      .finally(() => setLoading(false));
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const id = await api.post<AuthIdentity>("/auth/login", { username, password });
      setIdentity(id);
      applyPreferences(id);
    },
    [applyPreferences],
  );

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    setIdentity(null);
  }, []);

  const updateProfile = useCallback(
    async (payload: ProfilePayload) => {
      const id = await api.patch<AuthIdentity>("/auth/profile", payload);
      setIdentity(id);
      applyPreferences(id);
    },
    [applyPreferences],
  );

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.post("/auth/change-password", { currentPassword, newPassword });
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
    () => ({ identity, loading, login, logout, has, updateProfile, changePassword }),
    [identity, loading, login, logout, has, updateProfile, changePassword],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
