import type { ChildProcess } from "node:child_process";
import { setPriority } from "node:os";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";

/**
 * Baja la prioridad de CPU del proceso de dump (`nice`): si la CPU se satura, el
 * sistema atiende antes a la API y la app sigue respondiendo; el dump solo tarda
 * algo más. No es crítico: si falla, el dump sigue con prioridad normal.
 */
export function lowerPriority(child: ChildProcess): void {
  if (!env.DUMP_PROCESS_NICE || !child.pid) return;
  try {
    setPriority(child.pid, env.DUMP_PROCESS_NICE);
  } catch (err) {
    logger.warn({ err, pid: child.pid }, "No se pudo bajar la prioridad del proceso de dump");
  }
}
