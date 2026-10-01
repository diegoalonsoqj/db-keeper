import { rm } from "node:fs/promises";
import type { RetentionPolicy } from "@dbkeeper/shared";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../lib/http-error.js";
import * as serversRepo from "../servers/servers.repository.js";
import * as repo from "./backups.repository.js";
import { resolveBackupFile } from "./engine/files.js";

/** Límites defensivos para la política (evita valores absurdos en la BD). */
const MAX_DAYS = 3650; // ~10 años
const MAX_KEEP = 1000;

/**
 * Valida y normaliza `options.retention` enviado por el cliente. Devuelve la
 * política saneada, o `null` si no hay ninguna regla (para no guardar la clave).
 * Lanza 400 ante valores inválidos.
 */
export function normalizeRetention(options: Record<string, unknown> | undefined): RetentionPolicy | null {
  const raw = options?.retention;
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw HttpError.badRequest("La política de retención es inválida");
  }
  const r = raw as Record<string, unknown>;
  const days = field(r.days, "días", MAX_DAYS);
  const keepLast = field(r.keepLast, "últimos N", MAX_KEEP);
  if (days == null && keepLast == null) return null;
  return { days, keepLast };
}

/** Valida un campo de retención: null/ausente, o entero entre 1 y `max`. */
function field(value: unknown, label: string, max: number): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw HttpError.badRequest(`Retención (${label}): debe ser un entero entre 1 y ${max}`);
  }
  return n;
}

/** Lee la política almacenada en las options de un evento (tolerante). */
function parseStored(options: Record<string, unknown>): RetentionPolicy {
  const r = (options.retention ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null);
  return { days: num(r.days), keepLast: num(r.keepLast) };
}

/**
 * Aplica la retención de un evento: borra el archivo del disco local de los backups
 * que la incumplen y marca el ítem como purgado, conservando el registro para
 * auditoría. No lanza: cualquier fallo se loguea. Solo aplica al almacenamiento local:
 * la app nunca borra objetos de buckets, y SQL Server nativo se omite (su .bak vive
 * en el host de la instancia, fuera de nuestro alcance).
 */
export async function enforceRetentionForJob(jobId: string): Promise<void> {
  try {
    const job = await repo.findJobById(jobId);
    if (!job) return;
    const policy = parseStored(job.options);
    if (policy.days == null && policy.keepLast == null) return;

    const server = await serversRepo.findById(job.serverId);
    // Solo almacenamiento local: los métodos a bucket (gcloud, cloudsql_export) no se
    // purgan, y en SQL Server nativo el .bak vive en el host de la instancia.
    if (job.method !== "dump" || server?.engine === "sqlserver") return;

    const items = await repo.findPrunableItems(jobId, policy);
    if (items.length === 0) return;

    let pruned = 0;
    for (const item of items) {
      try {
        await deletePhysical(item.fileName);
        await repo.markItemPruned(item.id);
        pruned++;
      } catch (err) {
        logger.error({ err, itemId: item.id, jobId }, "No se pudo purgar un backup por retención");
      }
    }
    if (pruned > 0) {
      logger.info({ jobId, jobName: job.name, pruned, ...policy }, "Retención aplicada: backups purgados");
    }
  } catch (err) {
    logger.error({ err, jobId }, "Fallo al aplicar la retención del evento");
  }
}

/** Borra el archivo de backup local (la app nunca borra objetos de buckets). */
async function deletePhysical(fileName: string): Promise<void> {
  if (fileName.startsWith("gs://")) throw new Error("La retención no borra objetos de buckets");
  await rm(resolveBackupFile(fileName), { force: true });
}

/**
 * Barrido global de retención: recorre todos los eventos con política y la aplica.
 * Lo invoca el scheduler periódicamente para expirar backups por antigüedad
 * incluso en eventos que ya no se ejecutan.
 */
export async function sweepRetention(): Promise<void> {
  const ids = await repo.listJobIdsWithRetention();
  for (const id of ids) await enforceRetentionForJob(id);
}
