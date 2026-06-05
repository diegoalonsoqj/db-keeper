import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
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
import { gcpAccountsRouter } from "./modules/gcp-accounts/gcp-accounts.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

/**
 * Construye la app Express con la cadena base de middlewares.
 * La lógica de negocio vive en services/repositories; aquí solo se
 * ensambla la app y se montan los routers por módulo.
 */
export function createApp(): Express {
  const app = express();

  // Detrás de un proxy (Vite en dev, reverse proxy en prod): confiar para obtener IP real.
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.use(helmet());
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
  app.use("/api/gcp-accounts", gcpAccountsRouter);
  app.use("/api/settings", settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
