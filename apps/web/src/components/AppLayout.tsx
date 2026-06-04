import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Database,
  HardDrive,
  LayoutDashboard,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { PermissionKey } from "@dbkeeper/shared";
import { useAuth } from "../auth/AuthContext";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: PermissionKey;
}

const COLLAPSE_KEY = "dbkeeper.sidebarCollapsed";

export function AppLayout() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  function toggleSidebar() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const items: NavItem[] = [
    { to: "/", label: t("nav.dashboard"), icon: LayoutDashboard },
    { to: "/servers", label: t("nav.servers"), icon: Database, perm: "servers:read" },
    { to: "/buckets", label: t("nav.buckets"), icon: HardDrive, perm: "servers:read" },
    { to: "/users", label: t("nav.users"), icon: Users, perm: "users:read" },
    { to: "/roles", label: t("nav.roles"), icon: ShieldCheck, perm: "roles:read" },
    { to: "/audit", label: t("nav.audit"), icon: ScrollText, perm: "audit:read" },
    { to: "/settings", label: t("nav.settings"), icon: Settings, perm: "settings:read" },
  ];

  return (
    <div className={`app-shell${collapsed ? " collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          {!collapsed && <span className="brand">{t("app.name")}</span>}
          <button
            type="button"
            className="collapse-btn"
            onClick={toggleSidebar}
            title={collapsed ? "Expandir menú" : "Contraer menú"}
            aria-label="Alternar menú lateral"
          >
            {collapsed ? (
              <PanelLeftOpen size={20} strokeWidth={1.75} aria-hidden />
            ) : (
              <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>
        <nav>
          {items
            .filter((i) => !i.perm || has(i.perm))
            .map((i) => {
              const Icon = i.icon;
              return (
                <NavLink key={i.to} to={i.to} end={i.to === "/"} title={collapsed ? i.label : undefined}>
                  <Icon className="nav-icon" size={18} strokeWidth={1.75} aria-hidden />
                  <span className="nav-label">{i.label}</span>
                </NavLink>
              );
            })}
        </nav>
      </aside>
      <div className="content">
        <header className="app-header">
          <div className="header-left">
            <span className="tagline">{t("app.tagline")}</span>
          </div>
          <div className="header-right">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
