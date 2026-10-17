import { logger } from "../../config/logger.js";
import { notifyGroupRun, type GroupRunEventLine } from "../notifications/notifications.service.js";
import * as repo from "./group-runs.repository.js";

/** Largo máximo del motivo de fallo por evento en el resumen (Telegram corta a 4096). */
const MAX_ERROR_CHARS = 200;

/** Motivo legible: la última línea no vacía del log (suele ser el error), recortada. */
export function shortError(log: string | null): string {
  const lines = (log ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "error";
  return last.length > MAX_ERROR_CHARS ? `${last.slice(0, MAX_ERROR_CHARS - 1)}…` : last;
}

let sweeping = false;

/**
 * Envía el resumen de cada corrida de grupo que ya terminó. Se llama en cada pasada
 * de la cola (al terminar una ejecución y cada 30 s), así también cubre las cerradas
 * por cancelación o por reinicio. Nunca lanza.
 */
export async function settleGroupRuns(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const runs = await repo.claimFinishedRuns();
    for (const run of runs) {
      const execs = await repo.findRunExecutions(run.id);
      if (execs.length === 0) continue; // ejecuciones borradas: nada que resumir
      const lines: GroupRunEventLine[] = execs.map((e) => ({
        executionId: e.executionId,
        name: e.label,
        status: e.status === "success" ? "success" : "failed",
        durationMs: e.startedAt && e.finishedAt ? e.finishedAt.getTime() - e.startedAt.getTime() : null,
        dbCount: e.dbCount,
        totalBytes: e.totalBytes,
        error: e.status === "success" ? null : `${e.failedDb ? `${e.failedDb}: ` : ""}${shortError(e.failedLog)}`,
      }));
      for (const name of run.skipped) lines.push({ name, status: "skipped" });
      void notifyGroupRun({
        event: "summary",
        runId: run.id,
        group: run.groupName,
        runAt: run.createdAt,
        durationMs: run.finishedAt.getTime() - run.createdAt.getTime(),
        events: lines,
      });
    }
  } catch (err) {
    logger.error({ err }, "No se pudieron cerrar las corridas de grupo");
  } finally {
    sweeping = false;
  }
}
