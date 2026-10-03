import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { closePool } from "./db/pool.js";
import { recoverStaleExecutions, startCloudSqlVerifier } from "./modules/backups/engine/runner.js";
import { startExecutionQueue } from "./modules/backups/engine/queue.js";
import { startScheduler } from "./modules/backups/scheduler.js";

const app = createApp();

const server = app.listen(env.APP_PORT, () => {
  logger.info(`DBKeeper API escuchando en http://localhost:${env.APP_PORT} [${env.APP_ENV}]`);
  // El modelo de ejecución es en-proceso: un reinicio mata las corridas en curso.
  // Tras cerrar/retomar las corridas interrumpidas, lanza las que quedaron en cola.
  void recoverStaleExecutions().finally(startExecutionQueue);
  // Exports de Cloud SQL que superaron el timeout: se verifican en segundo plano.
  startCloudSqlVerifier();
  // Poller de programaciones (agendadas/recurrentes).
  startScheduler();
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

// Una promesa sin catch no debe tumbar el proceso (mataría los backups en curso):
// se registra y se sigue.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Promesa rechazada sin manejar");
});

// Tras una excepción no capturada el estado es incierto: se registra y se sale
// para que el gestor de procesos reinicie limpio.
process.on("uncaughtException", (err, origin) => {
  logger.fatal({ err, origin }, "Excepción no capturada; la API se cierra");
  process.exit(1);
});

process.on("exit", (code) => {
  logger.info({ code }, "Proceso de la API finalizado");
});
