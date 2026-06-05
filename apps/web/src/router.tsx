import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RequireAuth, RequirePermission } from "./auth/guards";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ServersPage } from "./pages/ServersPage";
import { EnvironmentsPage } from "./pages/EnvironmentsPage";
import { CredentialsPage } from "./pages/CredentialsPage";
import { BackupsPage } from "./pages/BackupsPage";
import { ExecutionsPage } from "./pages/ExecutionsPage";
import { StoragePage } from "./pages/StoragePage";
import { UsersPage } from "./pages/UsersPage";
import { RolesPage } from "./pages/RolesPage";
import { AuditPage } from "./pages/AuditPage";
import { SettingsPage } from "./pages/SettingsPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      {
        path: "servers",
        element: (
          <RequirePermission perm="servers:read">
            <ServersPage />
          </RequirePermission>
        ),
      },
      {
        path: "environments",
        element: (
          <RequirePermission perm="servers:read">
            <EnvironmentsPage />
          </RequirePermission>
        ),
      },
      {
        path: "credentials",
        element: (
          <RequirePermission perm="servers:read">
            <CredentialsPage />
          </RequirePermission>
        ),
      },
      {
        path: "backups",
        element: (
          <RequirePermission perm="backups:read">
            <BackupsPage />
          </RequirePermission>
        ),
      },
      {
        path: "executions",
        element: (
          <RequirePermission perm="backups:read">
            <ExecutionsPage />
          </RequirePermission>
        ),
      },
      {
        path: "storage",
        element: (
          <RequirePermission perm="servers:read">
            <StoragePage />
          </RequirePermission>
        ),
      },
      {
        path: "users",
        element: (
          <RequirePermission perm="users:read">
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: "roles",
        element: (
          <RequirePermission perm="roles:read">
            <RolesPage />
          </RequirePermission>
        ),
      },
      {
        path: "audit",
        element: (
          <RequirePermission perm="audit:read">
            <AuditPage />
          </RequirePermission>
        ),
      },
      {
        path: "settings",
        element: (
          <RequirePermission perm="settings:read">
            <SettingsPage />
          </RequirePermission>
        ),
      },
    ],
  },
]);
