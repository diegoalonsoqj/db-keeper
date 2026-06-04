import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RequireAuth, RequirePermission } from "./auth/guards";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ServersPage } from "./pages/ServersPage";
import { BucketsPage } from "./pages/BucketsPage";
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
        path: "buckets",
        element: (
          <RequirePermission perm="servers:read">
            <BucketsPage />
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
