import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api al backend en desarrollo para evitar CORS y usar rutas relativas.
// El puerto del backend se lee del `.env` raíz (APP_PORT), única fuente de verdad.
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, resolve(process.cwd(), "../.."), "");
  const apiPort = rootEnv.APP_PORT || "3001";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
