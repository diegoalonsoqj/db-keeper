import type { JobGroupDto, ScheduleDto, ScheduleInput } from "@dbkeeper/shared";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../lib/http-error.js";
import { isUniqueViolation } from "../../lib/pg-error.js";
import { enqueueExecution } from "../backups/engine/queue.js";
import * as schedulesRepo from "../backups/schedules.repository.js";
import { upsertForTarget } from "../backups/schedules.service.js";
import { notifyGroupRun } from "../notifications/notifications.service.js";
import * as repo from "./groups.repository.js";

export async function listGroups(p: { limit: number; offset: number }) {
  return repo.listGroups(p);
}

export async function getGroup(id: string): Promise<JobGroupDto> {
  const group = await repo.findById(id);
  if (!group) throw HttpError.notFound("Grupo no encontrado");
  return group;
}

async function ensureNameFree(name: string, exceptId?: string): Promise<void> {
  const existing = await repo.findIdByName(name);
  if (existing && existing !== exceptId) throw HttpError.badRequest("Ya existe un grupo con ese nombre");
}

/** Miembros sin duplicados (conserva el primer orden) y que existan todos. */
async function cleanJobIds(jobIds: string[]): Promise<string[]> {
  const ids = [...new Set(jobIds)];
  if (ids.length === 0) throw HttpError.badRequest("Agrega al menos un evento al grupo");
  const existing = new Set(await repo.findExistingJobIds(ids));
  const missing = ids.filter((id) => !existing.has(id));
  if (missing.length > 0) throw HttpError.badRequest("Alguno de los eventos seleccionados ya no existe");
  return ids;
}

/** Duplicado de nombre por carrera entre la validación y el INSERT/UPDATE. */
async function save(id: string | null, f: Partial<repo.GroupFields>, jobIds?: string[]): Promise<string> {
  try {
    return await repo.saveGroup(id, f, jobIds);
  } catch (err) {
    if (isUniqueViolation(err)) throw HttpError.badRequest("Ya existe un grupo con ese nombre");
    throw err;
  }
}

export async function createGroup(data: repo.GroupFields & { jobIds: string[] }): Promise<JobGroupDto> {
  const name = data.name.trim();
  await ensureNameFree(name);
  const jobIds = await cleanJobIds(data.jobIds);
  return getGroup(await save(null, { ...data, name }, jobIds));
}

export async function updateGroup(
  id: string,
  data: Partial<repo.GroupFields> & { jobIds?: string[] },
): Promise<JobGroupDto> {
  await getGroup(id);
  const name = data.name?.trim();
  if (name) await ensureNameFree(name, id);
  const jobIds = data.jobIds ? await cleanJobIds(data.jobIds) : undefined;
  await save(id, { ...data, name }, jobIds);
  return getGroup(id);
}

export async function deleteGroup(id: string): Promise<void> {
  await getGroup(id);
  await repo.deleteGroup(id); // la programación y los miembros caen en cascada
}

export async function getSchedule(id: string): Promise<ScheduleDto | null> {
  await getGroup(id);
  return schedulesRepo.findByTarget({ groupId: id });
}

/** Guarda la programación y avisa si coincide con otra que comparte eventos. */
export async function upsertSchedule(id: string, input: ScheduleInput): Promise<ScheduleDto> {
  await getGroup(id);
  const sched = await upsertForTarget({ groupId: id }, input);
  const overlaps = sched.nextRunAt ? await schedulesRepo.findOverlapsForGroup(id, new Date(sched.nextRunAt)) : [];
  return overlaps.length > 0 ? { ...sched, warnings: overlaps } : sched;
}

export async function deleteSchedule(id: string): Promise<void> {
  await schedulesRepo.deleteByTarget({ groupId: id });
}

export interface GroupRunResult {
  /** Ejecuciones creadas (una por evento activo), en el orden en que entran a la cola. */
  executionIds: string[];
  /** Eventos omitidos por estar inactivos. */
  skipped: string[];
}

/**
 * Lanza el grupo: crea una ejecución `pending` por evento activo (exports de Cloud SQL
 * primero, luego por posición) y avisa a la cola, que decide el paralelismo. Un grupo
 * inactivo solo se puede lanzar a mano.
 */
export async function runGroup(id: string, origin: "manual" | "scheduled"): Promise<GroupRunResult> {
  const group = await getGroup(id);
  if (origin === "scheduled" && !group.isActive) {
    logger.info({ groupId: id, group: group.name }, "Grupo inactivo: se omite el disparo programado");
    return { executionIds: [], skipped: [] };
  }
  const members = await repo.findMembersForRun(id);
  const runnable = members.filter((m) => m.isActive && m.databases.length > 0);
  const skipped = members.filter((m) => !runnable.includes(m)).map((m) => m.name);
  if (runnable.length === 0) throw HttpError.badRequest("El grupo no tiene eventos activos para ejecutar");
  const { runId, executionIds } = await repo.createGroupExecutions(
    { id, name: group.name, notifyMode: group.notifyMode },
    runnable,
    origin,
    skipped,
  );
  if (skipped.length > 0) {
    logger.info({ groupId: id, group: group.name, skipped }, "Grupo lanzado: eventos inactivos omitidos");
  }
  if (group.notifyStart) {
    void notifyGroupRun({
      event: "start",
      runId,
      group: group.name,
      runAt: new Date(),
      events: [
        ...runnable.map((m) => ({ name: m.name, status: "queued" as const, dbCount: m.databases.length })),
        ...skipped.map((name) => ({ name, status: "skipped" as const })),
      ],
    });
  }
  enqueueExecution();
  return { executionIds, skipped };
}
