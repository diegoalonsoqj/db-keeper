import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./i18n";
import { router } from "./router";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/ConfirmDialog";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <ThemeProvider>
            <RouterProvider router={router} />
          </ThemeProvider>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>,
);
