import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PermissionKey } from "@dbkeeper/shared";
import { useAuth } from "../auth/AuthContext";
import { LanguageSwitcher } from "./LanguageSwitcher";

interface NavItem {
  to: string;
  label: string;
  perm?: PermissionKey;
}

export function AppLayout() {
  const { t } = useTranslation();
  const { identity, logout, has } = useAuth();
  const navigate = useNavigate();

  const items: NavItem[] = [
    { to: "/", label: t("nav.dashboard") },
    { to: "/servers", label: t("nav.servers"), perm: "servers:read" },
    { to: "/buckets", label: t("nav.buckets"), perm: "servers:read" },
    { to: "/users", label: t("nav.users"), perm: "users:read" },
    { to: "/roles", label: t("nav.roles"), perm: "roles:read" },
    { to: "/audit", label: t("nav.audit"), perm: "audit:read" },
    { to: "/settings", label: t("nav.settings"), perm: "settings:read" },
  ];

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">{t("app.name")}</div>
        <nav>
          {items
            .filter((i) => !i.perm || has(i.perm))
            .map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"}>
                {i.label}
              </NavLink>
            ))}
        </nav>
      </aside>
      <div className="content">
        <header className="app-header">
          <span className="tagline">{t("app.tagline")}</span>
          <div className="header-right">
            <LanguageSwitcher />
            <span className="user-chip">{identity?.user.username}</span>
            <button className="secondary" onClick={onLogout}>
              {t("common.logout")}
            </button>
          </div>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
