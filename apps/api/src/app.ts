import { join, resolve } from "node:path";
import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { rolesRouter } from "./modules/roles/roles.routes.js";
import { permissionsRouter } from "./modules/permissions/permissions.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { serversRouter } from "./modules/servers/servers.routes.js";
import { environmentsRouter } from "./modules/environments/environments.routes.js";
import { credentialsRouter } from "./modules/credentials/credentials.routes.js";
import { backupsRouter } from "./modules/backups/backups.routes.js";
import { storageRouter } from "./modules/storage/storage.routes.js";
import { cloudCredentialsRouter } from "./modules/cloud-credentials/cloud-credentials.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

/**
 * Construye la app Express con la cadena base de middlewares.
 * La lógica de negocio vive en services/repositories; aquí solo se
 * ensambla la app y se montan los routers por módulo.
 */
export function createApp(): Express {
  const app = express();

  // Detrás de un proxy (Vite en dev, reverse proxy en prod): confiar para obtener IP real.
  // Con "true" cualquiera podría falsear su IP con X-Forwarded-For: se configura por env.
  app.set("trust proxy", parseTrustProxy(env.TRUST_PROXY));
  app.disable("x-powered-by");
  app.use(
    helmet({
      // Si la API sirve el front (SERVE_WEB), se relaja la CSP para una SPA por
      // HTTP: estilos inline de React e imágenes/fuentes embebidas como data:.
      // Sin upgrade-insecure-requests para no forzar HTTPS en despliegue interno.
      // En modo solo-API se mantiene la CSP estricta por defecto de helmet.
      contentSecurityPolicy: env.SERVE_WEB
        ? {
            useDefaults: false,
            directives: {
              "default-src": ["'self'"],
              "script-src": ["'self'"],
              "style-src": ["'self'", "'unsafe-inline'"],
              "img-src": ["'self'", "data:"],
              "font-src": ["'self'", "data:"],
              "connect-src": ["'self'"],
              "object-src": ["'none'"],
              "base-uri": ["'self'"],
              "frame-ancestors": ["'self'"],
            },
          }
        : undefined,
    }),
  );
  // CORS con credenciales para permitir la cookie de sesión desde el frontend.
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      // No ensuciar el log con los chequeos de salud.
      autoLogging: { ignore: (req) => req.url === "/api/health" || req.url === "/api/ready" },
      // Peticiones normales en `debug` (ocultas con LOG_LEVEL=info); errores sí visibles.
      // El polling de Ejecuciones y los GET de listados dejan de inundar la consola.
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "debug";
      },
    }),
  );

  // Routers por módulo.
  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/permissions", permissionsRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/servers", serversRouter);
  app.use("/api/environments", environmentsRouter);
  app.use("/api/credentials", credentialsRouter);
  app.use("/api/backups", backupsRouter);
  app.use("/api/storage", storageRouter);
  app.use("/api/cloud-credentials", cloudCredentialsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/dashboard", dashboardRouter);

  // Front (SPA) servido por la propia API: despliegue de un solo puerto. Va tras
  // los routers /api para que la API siempre tenga prioridad sobre los estáticos.
  if (env.SERVE_WEB) {
    const webDist = resolve(env.WEB_DIST_PATH);
    app.use(express.static(webDist));
    // Fallback SPA: un GET que no sea de la API ni un archivo existente devuelve
    // index.html (el enrutado lo resuelve React Router en el cliente).
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(join(webDist, "index.html"));
    });
    logger.info(`Sirviendo front desde ${webDist}`);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** TRUST_PROXY → valor de Express: "true"/"false", número de saltos, o IPs/subredes. */
function parseTrustProxy(v: string): boolean | number | string {
  const s = v.trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false" || s === "") return false;
  if (/^\d+$/.test(s)) return Number(s);
  return v.trim();
}
