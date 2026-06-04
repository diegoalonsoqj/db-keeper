import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { logger } from "./config/logger.js";
import { healthRouter } from "./routes/health.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

/**
 * Construye la app Express con la cadena base de middlewares.
 * La lógica de negocio vive en services/repositories; aquí solo se
 * ensambla la app y se montan los routers por módulo.
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  // CORS restrictivo se afinará al cerrar el origen del frontend (Etapa 1).
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  // Routers por módulo. En Etapa 0 solo health/ready.
  app.use("/api", healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
