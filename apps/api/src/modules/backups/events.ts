import { EventEmitter } from "node:events";
import type { BackupStreamEvent } from "@dbkeeper/shared";
import { logger } from "../../config/logger.js";
import * as repo from "./backups.repository.js";

/**
 * Bus in-proceso de eventos de ejecución (Fase A del tiempo real). El runner
 * publica al cambiar de estado y cada conexión SSE se suscribe. La Fase B
 * (cola + Redis) reinyectará aquí los eventos recibidos por pub/sub, de modo que
 * el endpoint SSE no necesita cambiar. Ver `docs/REALTIME-QUEUE-DESIGN.md`.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0); // una suscripción por conexión SSE; sin tope artificial

/** Publica un evento a todas las suscripciones (SSE) del proceso. */
export function publishEvent(evt: BackupStreamEvent): void {
  bus.emit("event", evt);
  // Fase B: aquí se añadirá `redisPub.publish("backups:events", JSON.stringify(evt))`.
}

/** Suscribe un manejador; devuelve la función para cancelar la suscripción. */
export function subscribe(fn: (e: BackupStreamEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}

/** Empuja un lote de líneas de consola en vivo de una BD de la ejecución. */
export function emitLog(executionId: string, dbName: string, lines: string[]): void {
  if (lines.length > 0) publishEvent({ type: "execution-log", executionId, dbName, lines });
}

/**
 * Publica el snapshot actual de una ejecución. Lee el estado de la BD y emite.
 * Nunca lanza: un fallo al emitir no debe afectar a la corrida del backup.
 */
export async function emitExecution(executionId: string): Promise<void> {
  try {
    const execution = await repo.findExecutionById(executionId);
    if (execution) publishEvent({ type: "execution-updated", execution });
  } catch (err) {
    logger.error({ err, executionId }, "No se pudo emitir el evento de ejecución");
  }
}
