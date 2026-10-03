import type { ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";

/** Límites de un dump: corte por inactividad y tope total (red de seguridad). */
export interface DumpLimits {
  inactivityMs: number;
  maxMs: number;
}

export type StopReason = "inactivity" | "max";

export interface Supervision {
  /** Registra actividad (p. ej. una línea en stderr). */
  activity: () => void;
  /** Por qué se detuvo el proceso, si lo detuvo el supervisor. */
  reason: () => StopReason | null;
  stop: () => void;
}

/** Cada cuánto se revisa el archivo de salida. */
const CHECK_MS = 15_000;

/**
 * Vigila un proceso de dump: lo detiene si **deja de avanzar** (el archivo de salida
 * no crece ni hay salida por stderr) durante `inactivityMs`, o si supera `maxMs` en
 * total. Así un dump grande que avanza nunca se corta por tiempo y uno colgado se
 * detecta pronto.
 */
export function superviseDump(child: ChildProcess, filePath: string, limits: DumpLimits): Supervision {
  const start = Date.now();
  let lastActivity = start;
  let lastSize = -1;
  let stopped: StopReason | null = null;

  const kill = (why: StopReason): void => {
    if (stopped) return;
    stopped = why;
    child.kill("SIGTERM");
  };

  const timer = setInterval(() => {
    void stat(filePath)
      .then((s) => {
        if (s.size !== lastSize) {
          lastSize = s.size;
          lastActivity = Date.now();
        }
      })
      .catch(() => {}) // aún no existe: cuenta como sin avance
      .finally(() => {
        const now = Date.now();
        if (now - start >= limits.maxMs) kill("max");
        else if (now - lastActivity >= limits.inactivityMs) kill("inactivity");
      });
  }, CHECK_MS);
  timer.unref?.();

  return {
    activity: () => {
      lastActivity = Date.now();
    },
    reason: () => stopped,
    stop: () => clearInterval(timer),
  };
}
