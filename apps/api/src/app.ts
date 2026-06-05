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
import { credentialsRouter } from "./modules/credentials/credentials.routes.js";
import { bucketsRouter } from "./modules/buckets/buckets.routes.js";
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
  app.use(pinoHttp({ logger }));

  // Routers por módulo.
  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/permissions", permissionsRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/servers", serversRouter);
  app.use("/api/credentials", credentialsRouter);
  app.use("/api/buckets", bucketsRouter);
  app.use("/api/settings", settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
