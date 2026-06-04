import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";

/**
 * Rutas base (Etapa 0). El login y las rutas protegidas por rol
 * se añaden en la Etapa 1.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [{ index: true, element: <DashboardPage /> }],
  },
]);
