import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PermissionKey } from "@dbkeeper/shared";
import { useAuth } from "../auth/AuthContext";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  perm?: PermissionKey;
}

const COLLAPSE_KEY = "dbkeeper.sidebarCollapsed";

export function AppLayout() {
  const { t } = useTranslation();
  const { identity, logout, has } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  function toggleSidebar() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const items: NavItem[] = [
    { to: "/", label: t("nav.dashboard"), icon: "📊" },
    { to: "/servers", label: t("nav.servers"), icon: "🗄️", perm: "servers:read" },
    { to: "/buckets", label: t("nav.buckets"), icon: "🪣", perm: "servers:read" },
    { to: "/users", label: t("nav.users"), icon: "👥", perm: "users:read" },
    { to: "/roles", label: t("nav.roles"), icon: "🛡️", perm: "roles:read" },
    { to: "/audit", label: t("nav.audit"), icon: "📜", perm: "audit:read" },
    { to: "/settings", label: t("nav.settings"), icon: "⚙️", perm: "settings:read" },
  ];

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className={`app-shell${collapsed ? " collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">{collapsed ? "DB" : t("app.name")}</div>
        <nav>
          {items
            .filter((i) => !i.perm || has(i.perm))
            .map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} title={collapsed ? i.label : undefined}>
                <span className="nav-icon">{i.icon}</span>
                <span className="nav-label">{i.label}</span>
              </NavLink>
            ))}
        </nav>
      </aside>
      <div className="content">
        <header className="app-header">
          <div className="header-left">
            <button
              type="button"
              className="secondary icon-btn"
              onClick={toggleSidebar}
              title={collapsed ? "Expandir menú" : "Contraer menú"}
              aria-label="Alternar menú lateral"
            >
              ☰
            </button>
            <span className="tagline">{t("app.tagline")}</span>
          </div>
          <div className="header-right">
            <ThemeToggle />
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
