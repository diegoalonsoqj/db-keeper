import type { BackupJobDto, ExecutionDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import * as serversRepo from "../servers/servers.repository.js";
import * as credsRepo from "../credentials/credentials.repository.js";
import * as storageRepo from "../storage/storage.repository.js";
import { access } from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";
import { decryptSecret } from "../../lib/crypto.js";
import * as repo from "./backups.repository.js";
import type { JobFields } from "./backups.repository.js";
import { runExecution, resolveBackupFile } from "./engine/runner.js";
import { parseGcsUri } from "./engine/gcs.js";

export interface JobData {
  name: string;
  serverId: string;
  credentialId: string | null;
  method: "dump" | "gcloud";
  bucketId: string | null;
  options: Record<string, unknown>;
  isActive: boolean;
  databases: string[];
}

/** Valida las referencias (instancia, credencial override, bucket) y el método. */
async function validateRefs(data: Partial<JobData>): Promise<void> {
  if (data.serverId && !(await serversRepo.findById(data.serverId))) {
    throw HttpError.badRequest("La instancia seleccionada no existe");
  }
  if (data.credentialId && !(await credsRepo.findById(data.credentialId))) {
    throw HttpError.badRequest("La credencial seleccionada no existe");
  }
  if (data.bucketId && !(await storageRepo.findById(data.bucketId))) {
    throw HttpError.badRequest("El bucket seleccionado no existe");
  }
  if (data.method === "gcloud" && !data.bucketId) {
    throw HttpError.badRequest("El método gcloud requiere un bucket de destino");
  }
}

/**
 * Consolida el ambiente del evento a partir de la instancia y la credencial
 * efectiva (override o la heredada de la instancia). Si ambos tienen ambiente y
 * **no coinciden**, lanza error: respaldar una instancia de un ambiente con una
 * credencial de otro es casi siempre un descuido peligroso.
 */
async function resolveEnvironment(
  serverId: string,
  credentialIdOverride: string | null,
): Promise<string | null> {
  const server = await serversRepo.findById(serverId);
  if (!server) return null; // validateRefs ya lo verificó; guarda defensiva
  const credId = credentialIdOverride ?? server.credentialId;
  const cred = credId ? await credsRepo.findById(credId) : null;
  const envServer = server.environment?.trim() || null;
  const envCred = cred?.environment?.trim() || null;
  if (envServer && envCred && envServer.toLowerCase() !== envCred.toLowerCase()) {
    throw HttpError.badRequest(
      `El ambiente de la instancia (${envServer}) no coincide con el de la credencial (${envCred})`,
    );
  }
  return envServer ?? envCred;
}

/** Quita duplicados (ignorando mayúsculas) y vacíos de la lista de BDs. */
function cleanDatabases(names: string[]): string[] {
  const seen = new Set<string>();
  return names
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

export async function listJobs(p: { limit: number; offset: number }) {
  return repo.listJobs(p);
}

export async function getJob(id: string): Promise<BackupJobDto> {
  const job = await repo.findJobById(id);
  if (!job) throw HttpError.notFound("Evento de backup no encontrado");
  return job;
}

export async function createJob(data: JobData): Promise<BackupJobDto> {
  await validateRefs(data);
  const databases = cleanDatabases(data.databases);
  if (databases.length === 0) throw HttpError.badRequest("Selecciona al menos una base de datos");
  const environment = await resolveEnvironment(data.serverId, data.credentialId);
  const { databases: _omit, ...fields } = data;
  const id = await repo.insertJob({ ...fields, environment }, databases);
  return getJob(id);
}

export async function updateJob(id: string, data: Partial<JobData>): Promise<BackupJobDto> {
  const current = await repo.findJobById(id);
  if (!current) throw HttpError.notFound("Evento de backup no encontrado");
  await validateRefs(data);
  let databases: string[] | undefined;
  if (data.databases) {
    databases = cleanDatabases(data.databases);
    if (databases.length === 0) throw HttpError.badRequest("Selecciona al menos una base de datos");
  }
  // Recalcula el ambiente con la instancia/credencial resultantes y revalida.
  const serverId = data.serverId ?? current.serverId;
  const credentialId = data.credentialId !== undefined ? data.credentialId : current.credentialId;
  const environment = await resolveEnvironment(serverId, credentialId);
  const { databases: _omit, ...fields } = data;
  await repo.updateJob(id, { ...fields, environment }, databases);
  return getJob(id);
}

export async function deleteJob(id: string): Promise<void> {
  if (!(await repo.findJobById(id))) throw HttpError.notFound("Evento de backup no encontrado");
  await repo.deleteJob(id);
}

/**
 * Lanza el evento ahora: crea la ejecución (origen manual) con un ítem por BD en
 * estado `pending` y dispara el motor en segundo plano. Devuelve la ejecución
 * recién creada (aún `pending`); el front refresca para ver el progreso.
 */
export async function runNow(jobId: string): Promise<ExecutionDto> {
  const job = await getJob(jobId);
  const execId = await repo.createExecution(jobId, job.name, job.environment, job.databases);
  const exec = await repo.findExecutionById(execId);
  if (!exec) throw HttpError.notFound("Ejecución no encontrada");
  // Fire-and-forget: el motor actualiza los estados en la BD; los errores se
  // reflejan en la propia ejecución y se loguean dentro del runner.
  void runExecution(execId).catch((err) => logger.error({ err, execId }, "Error al disparar el motor"));
  return exec;
}

export async function listExecutions(p: { limit: number; offset: number; jobId?: string }) {
  return repo.listExecutions(p);
}

/**
 * Reintenta una ejecución: crea una nueva corrida del mismo evento con las mismas
 * BDs registradas y dispara el motor. Devuelve la nueva ejecución (`pending`).
 */
export async function retryExecution(executionId: string): Promise<ExecutionDto> {
  const exec = await repo.findExecutionById(executionId);
  if (!exec) throw HttpError.notFound("Ejecución no encontrada");
  if (!exec.jobId) throw HttpError.badRequest("El evento ya no existe; no se puede reintentar");
  const job = await repo.findJobById(exec.jobId);
  if (!job) throw HttpError.badRequest("El evento ya no existe; no se puede reintentar");
  const databases = exec.items.map((it) => it.dbName);
  const newId = await repo.createExecution(exec.jobId, exec.label, job.environment, databases);
  const created = await repo.findExecutionById(newId);
  if (!created) throw HttpError.notFound("Ejecución no encontrada");
  void runExecution(newId).catch((err) => logger.error({ err, newId }, "Error al disparar el motor"));
  return created;
}

/** Origen del archivo a descargar: disco local o un objeto en GCS. */
export type DownloadSource =
  | { kind: "local"; filePath: string; fileName: string }
  | { kind: "gcs"; bucket: string; object: string; serviceAccountJson: string | null; fileName: string };

/** Resuelve el archivo descargable de un ítem (valida pertenencia y existencia). */
export async function getItemDownload(executionId: string, itemId: string): Promise<DownloadSource> {
  const item = await repo.findItemFile(executionId, itemId);
  if (!item) throw HttpError.notFound("Ítem de ejecución no encontrado");
  if (!item.fileName) throw HttpError.badRequest("Esta base de datos no generó un archivo");

  // Objeto en GCS: resolver credenciales por el bucket y servir por streaming.
  if (item.fileName.startsWith("gs://")) {
    const parsed = parseGcsUri(item.fileName);
    if (!parsed) throw HttpError.badRequest("URI de backup inválida");
    const target = await storageRepo.findGcsByBucket(parsed.bucket);
    const enc = target ? await storageRepo.getServiceAccountEncrypted(target.id) : null;
    return {
      kind: "gcs",
      bucket: parsed.bucket,
      object: parsed.object,
      serviceAccountJson: enc ? decryptSecret(enc) : null,
      fileName: path.basename(parsed.object),
    };
  }

  const filePath = resolveBackupFile(item.fileName);
  try {
    await access(filePath);
  } catch {
    throw HttpError.notFound("El archivo de backup ya no está disponible");
  }
  return { kind: "local", filePath, fileName: path.basename(item.fileName) };
}
