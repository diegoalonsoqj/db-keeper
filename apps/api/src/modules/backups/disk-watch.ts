import { statfs } from "node:fs/promises";
import { logger } from "../../config/logger.js";
import { notifyDiskLow } from "../notifications/notifications.service.js";
import { getBackupSettings } from "../settings/settings.service.js";
import { resolveLocalRoot } from "./engine/runner.js";

/** Puntos de margen para dar el disco por recuperado (evita avisos intermitentes). */
const HYSTERESIS_PCT = 2;

/** Disco ya avisado y aún sin recuperarse (en memoria: tras un reinicio se reevalúa). */
let alerted = false;

export interface DiskUsage {
  path: string;
  totalBytes: number;
  freeBytes: number;
  freePct: number;
}

/** Espacio del disco donde se escriben los backups (null si la ruta no existe aún). */
export async function backupDiskUsage(): Promise<DiskUsage | null> {
  const root = await resolveLocalRoot();
  try {
    const s = await statfs(root);
    const totalBytes = s.blocks * s.bsize;
    // bavail: lo disponible para procesos sin privilegios (lo que de verdad pueden usar los dumps).
    const freeBytes = s.bavail * s.bsize;
    return { path: root, totalBytes, freeBytes, freePct: totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 100 };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Avisa una vez cuando el espacio libre del disco de backups baja del umbral, y se
 * rearma al recuperarse (umbral + margen). Solo en la líder (la llama el scheduler).
 * Nunca lanza.
 */
export async function checkBackupDisk(): Promise<void> {
  try {
    const { diskFreeAlertPercent } = await getBackupSettings();
    if (diskFreeAlertPercent <= 0) return;
    const usage = await backupDiskUsage();
    if (!usage) return;
    if (usage.freePct < diskFreeAlertPercent) {
      if (alerted) return;
      alerted = true;
      logger.warn({ ...usage, threshold: diskFreeAlertPercent }, "Poco espacio libre en el disco de backups");
      await notifyDiskLow(usage, diskFreeAlertPercent);
    } else if (usage.freePct >= diskFreeAlertPercent + HYSTERESIS_PCT) {
      alerted = false;
    }
  } catch (err) {
    logger.error({ err }, "No se pudo revisar el espacio del disco de backups");
  }
}
