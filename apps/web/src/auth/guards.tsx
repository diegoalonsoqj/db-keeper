import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PermissionKey } from "@dbkeeper/shared";
import { useAuth } from "./AuthContext";

/** Bloquea el acceso al shell si no hay sesión; mientras carga muestra un placeholder. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { identity, loading } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (loading) return <div className="centered muted">{t("common.loading")}</div>;
  if (!identity) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

/** Restringe una ruta a quienes tengan el permiso indicado. */
export function RequirePermission({ perm, children }: { perm: PermissionKey; children: ReactNode }) {
  const { has } = useAuth();
  if (!has(perm)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
