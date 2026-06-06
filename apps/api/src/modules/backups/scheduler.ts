import { logger } from "../../config/logger.js";
import * as repo from "./schedules.repository.js";
import { nextRunForCron } from "./schedule-time.js";
import { runScheduled } from "./backups.service.js";
import { sweepRetention } from "./retention.js";

const TICK_MS = 60_000; // un minuto
const RETENTION_SWEEP_MS = 3_600_000; // cada hora

let timer: NodeJS.Timeout | null = null;
let lastRetentionSweep = 0;

/** Dispara las programaciones vencidas y recalcula el próximo disparo. */
async function tick(): Promise<void> {
  const now = new Date();
  const due = await repo.findDue(now);
  for (const s of due) {
    try {
      await runScheduled(s.jobId);
    } catch (err) {
      logger.error({ err, jobId: s.jobId }, "No se pudo disparar el backup programado");
    }
    if (s.mode === "once") {
      // Una sola vez: desactivar tras disparar.
      await repo.markRan(s.id, { lastRunAt: now, nextRunAt: null, isActive: false });
    } else {
      let next: Date | null = null;
      try {
        next = nextRunForCron(s.cron!, s.timezone, now);
      } catch (err) {
        logger.error({ err, scheduleId: s.id }, "Cron inválido: se desactiva la programación");
      }
      await repo.markRan(s.id, { lastRunAt: now, nextRunAt: next, isActive: next !== null });
    }
  }

  // Barrido de retención (a lo sumo cada hora): expira backups por antigüedad
  // incluso en eventos que ya no se ejecutan.
  if (now.getTime() - lastRetentionSweep >= RETENTION_SWEEP_MS) {
    lastRetentionSweep = now.getTime();
    await sweepRetention().catch((err) => logger.error({ err }, "Fallo en el barrido de retención"));
  }
}

/** Inicia el poller (un tick al arrancar y luego cada minuto). */
export function startScheduler(): void {
  if (timer) return;
  void tick().catch((err) => logger.error({ err }, "Fallo en el scheduler"));
  timer = setInterval(() => void tick().catch((err) => logger.error({ err }, "Fallo en el scheduler")), TICK_MS);
  timer.unref();
  logger.info("Scheduler de backups iniciado (poll 60s).");
}
