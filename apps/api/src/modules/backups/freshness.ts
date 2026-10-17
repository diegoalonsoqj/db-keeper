import { logger } from "../../config/logger.js";
import { notifyStaleJobs, type StaleJob } from "../notifications/notifications.service.js";
import { getBackupSettings } from "../settings/settings.service.js";
import * as repo from "./freshness.repository.js";
import { prevRunForCron } from "./schedule-time.js";

/** Disparo esperado más reciente de cada evento (el mayor entre sus programaciones). */
export interface ExpectedFire {
  jobId: string;
  jobName: string;
  fireAt: Date;
  alertedFireAt: Date | null;
}

/**
 * Para cada evento, el último disparo que ya debió producir un backup: el más reciente
 * en o antes de `now - grace` y posterior a la entrada en vigor de la programación.
 * Usa el disparo real del cron (no un intervalo fijo), así un cron de lunes a viernes
 * no exige backup el domingo.
 */
export function expectedFires(schedules: repo.WatchedSchedule[], now: Date, graceMs: number): ExpectedFire[] {
  const cutoff = new Date(now.getTime() - graceMs);
  const byJob = new Map<string, ExpectedFire>();
  for (const s of schedules) {
    let fireAt: Date;
    try {
      fireAt = prevRunForCron(s.cron, s.timezone, cutoff);
    } catch {
      continue; // cron inválido: el scheduler ya lo desactiva y lo registra
    }
    if (fireAt < s.since) continue;
    const prev = byJob.get(s.jobId);
    if (!prev || fireAt > prev.fireAt) {
      byJob.set(s.jobId, { jobId: s.jobId, jobName: s.jobName, fireAt, alertedFireAt: s.alertedFireAt });
    }
  }
  return [...byJob.values()];
}

let checking = false;

/**
 * Vigilancia de frescura: avisa (un solo mensaje con todos) de los eventos programados
 * que no tienen un backup correcto desde su último disparo pasado el margen, y que no
 * siguen en cola ni en curso. Cada disparo se avisa una vez. Solo en la líder (la
 * llama el scheduler). Nunca lanza.
 */
export async function checkFreshness(now = new Date()): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const { staleAlertGraceHours } = await getBackupSettings();
    if (staleAlertGraceHours <= 0) return;
    const fires = expectedFires(await repo.findWatchedSchedules(), now, staleAlertGraceHours * 3_600_000);
    // Sin avisar aún este disparo.
    const pending = fires.filter((f) => !f.alertedFireAt || f.alertedFireAt < f.fireAt);
    if (pending.length === 0) return;

    const status = new Map((await repo.findFireStatus(pending)).map((s) => [s.jobId, s]));
    const stale: (StaleJob & { jobId: string })[] = [];
    for (const f of pending) {
      const st = status.get(f.jobId);
      if (!st || st.succeeded || st.inProgress) continue;
      stale.push({ jobId: f.jobId, jobName: f.jobName, expectedAt: f.fireAt, lastSuccessAt: st.lastSuccessAt });
    }
    if (stale.length === 0) return;

    // Marcar antes de enviar: si el envío falla, no se reintenta en bucle cada pasada.
    await repo.markStaleAlerted(stale.map((s) => ({ jobId: s.jobId, fireAt: s.expectedAt })));
    logger.warn({ jobs: stale.map((s) => s.jobName) }, "Eventos sin backup correcto tras su último disparo");
    await notifyStaleJobs(stale, staleAlertGraceHours);
  } catch (err) {
    logger.error({ err }, "Fallo en la vigilancia de backups atrasados");
  } finally {
    checking = false;
  }
}
