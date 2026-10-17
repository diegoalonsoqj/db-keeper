import { logger } from "../../config/logger.js";
import * as repo from "./schedules.repository.js";
import { nextRunForCron } from "./schedule-time.js";
import { runScheduled } from "./backups.service.js";
import { runGroup } from "../groups/groups.service.js";
import { sweepRetention } from "./retention.js";
import { checkFreshness } from "./freshness.js";
import { checkBackupDisk } from "./disk-watch.js";

const TICK_MS = 60_000; // un minuto
const RETENTION_SWEEP_MS = 3_600_000; // cada hora
const FRESHNESS_CHECK_MS = 10 * 60_000; // cada 10 minutos

let timer: NodeJS.Timeout | null = null;
let lastRetentionSweep = 0;
let lastFreshnessCheck = 0;

/** Dispara las programaciones vencidas y recalcula el próximo disparo. */
async function tick(): Promise<void> {
  const now = new Date();
  const due = await repo.findDue(now);
  for (const s of due) {
    // Próximo disparo: una sola vez → se desactiva; recurrente → siguiente del cron.
    let next: Date | null = null;
    if (s.mode !== "once") {
      try {
        next = nextRunForCron(s.cron!, s.timezone, now);
      } catch (err) {
        logger.error({ err, scheduleId: s.id }, "Cron inválido: se desactiva la programación");
      }
    }
    // Reservar antes de disparar: si otro proceso ya la tomó, no se duplica el backup.
    const claimed = await repo.claimRun(s.id, new Date(s.nextRunAt!), {
      lastRunAt: now,
      nextRunAt: next,
      isActive: next !== null,
    });
    if (!claimed) continue;
    try {
      if (s.groupId) await runGroup(s.groupId, "scheduled");
      else if (s.jobId) await runScheduled(s.jobId);
    } catch (err) {
      logger.error({ err, jobId: s.jobId, groupId: s.groupId }, "No se pudo disparar el backup programado");
    }
  }

  // Barrido de retención (a lo sumo cada hora): expira backups por antigüedad
  // incluso en eventos que ya no se ejecutan.
  if (now.getTime() - lastRetentionSweep >= RETENTION_SWEEP_MS) {
    lastRetentionSweep = now.getTime();
    await sweepRetention().catch((err) => logger.error({ err }, "Fallo en el barrido de retención"));
  }

  // Vigilancia: eventos sin backup correcto tras su disparo y espacio en disco (nunca lanzan).
  if (now.getTime() - lastFreshnessCheck >= FRESHNESS_CHECK_MS) {
    lastFreshnessCheck = now.getTime();
    await checkFreshness(now);
    await checkBackupDisk();
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
