import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { closePool } from "./db/pool.js";
import { recoverStaleExecutions } from "./modules/backups/engine/runner.js";

const app = createApp();

const server = app.listen(env.APP_PORT, () => {
  logger.info(`DBKeeper API escuchando en http://localhost:${env.APP_PORT} [${env.APP_ENV}]`);
  // El modelo de ejecución es en-proceso: un reinicio mata las corridas en curso.
  void recoverStaleExecutions();
});

/** Apagado ordenado: deja de aceptar conexiones y cierra el pool. */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Apagando API…");
  server.close(async () => {
    await closePool();
    logger.info("API apagada limpiamente.");
    process.exit(0);
  });
  // Forzar salida si algo se cuelga.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
