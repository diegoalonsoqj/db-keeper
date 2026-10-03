import type { BackupJobDto, BackupMethod, ExecutionDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import * as serversRepo from "../servers/servers.repository.js";
import * as credsRepo from "../credentials/credentials.repository.js";
import * as storageRepo from "../storage/storage.repository.js";
import { getServiceAccountJson } from "../cloud-credentials/cloud-credentials.service.js";
import { access } from "node:fs/promises";
import path from "node:path";
import * as repo from "./backups.repository.js";
import type { JobFields } from "./backups.repository.js";
import { enqueueExecution } from "./engine/queue.js";
import { resolveBackupFile } from "./engine/files.js";
import { parseGcsUri } from "./engine/gcs.js";
import { normalizeRetention } from "./retention.js";

export interface JobData {
  name: string;
  serverId: string;
  credentialId: string | null;
  method: BackupMethod;
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
 * El export de Cloud SQL exige una instancia SQL Server marcada como Cloud SQL (con
 * proyecto e instancia GCP) y un bucket de GCP: la instancia escribe el .bak allí.
 */
async function assertCloudSqlExport(serverId: string, bucketId: string | null): Promise<void> {
  const server = await serversRepo.findById(serverId);
  if (!server) throw HttpError.badRequest("La instancia seleccionada no existe");
  if (server.engine !== "sqlserver") {
    throw HttpError.badRequest("El export de Cloud SQL solo está disponible para SQL Server");
  }
  if (!server.isCloudSql || !server.gcpProject || !server.gcpInstance) {
    throw HttpError.badRequest("La instancia debe estar marcada como Cloud SQL con proyecto e instancia GCP");
  }
  const target = bucketId ? await storageRepo.findById(bucketId) : null;
  if (!target || target.type !== "bucket" || !target.bucket) {
    throw HttpError.badRequest("El export de Cloud SQL requiere un bucket de destino");
  }
  if (target.provider !== "gcp") {
    throw HttpError.badRequest("El export de Cloud SQL requiere un bucket de GCP");
  }
}

/**
 * Dump y "subir a bucket" se conectan a la BD: la instancia necesita host. (Una
 * Cloud SQL sin host solo admite el export; mejor avisarlo al guardar que al ejecutar.)
 */
async function assertDumpable(serverId: string): Promise<void> {
  const server = await serversRepo.findById(serverId);
  if (server && !server.host) {
    throw HttpError.badRequest(
      "La instancia no tiene host/IP: este método se conecta a la BD. Usa 'Export Cloud SQL' o indica el host en la instancia",
    );
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

/**
 * Valida la retención de `options` y devuelve una copia con la clave saneada. Solo
 * aplica al método local (`dump`): en los métodos a bucket se descarta, porque la app
 * no borra objetos de buckets.
 */
function applyRetention(options: Record<string, unknown>, method: BackupMethod): Record<string, unknown> {
  const retention = method === "dump" ? normalizeRetention(options) : null;
  const next = { ...options };
  if (retention) next.retention = retention;
  else delete next.retention;
  return next;
}

/** Nombre de esquema de PostgreSQL (identificador, máx. 63 bytes). */
const MAX_SCHEMA_LEN = 63;

/**
 * `options.excludeSchemas` = { bd: [esquemas] }. Conserva solo BDs del evento,
 * nombres válidos y sin duplicados; si no queda nada, quita la opción.
 */
function normalizeExcludeSchemas(options: Record<string, unknown>, databases: string[]): Record<string, unknown> {
  const next = { ...options };
  const raw = options.excludeSchemas;
  const out: Record<string, string[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const db of databases) {
      const list = (raw as Record<string, unknown>)[db];
      if (!Array.isArray(list)) continue;
      const schemas = [...new Set(list.map((s) => String(s).trim()))].filter(
        (s) => s.length > 0 && s.length <= MAX_SCHEMA_LEN && !s.includes("\0"),
      );
      if (schemas.length > 0) out[db] = schemas.slice(0, 200);
    }
  }
  if (Object.keys(out).length > 0) next.excludeSchemas = out;
  else delete next.excludeSchemas;
  return next;
}

/** Un destino recién asignado a un evento debe estar activo. */
async function assertActiveBucket(bucketId: string | null | undefined): Promise<void> {
  if (!bucketId) return;
  const t = await storageRepo.findById(bucketId);
  if (t && !t.isActive) throw HttpError.badRequest(`El destino '${t.name}' está inactivo`);
}

export async function createJob(data: JobData): Promise<BackupJobDto> {
  await validateRefs(data);
  await assertActiveBucket(data.bucketId);
  if (data.method === "cloudsql_export") await assertCloudSqlExport(data.serverId, data.bucketId);
  else await assertDumpable(data.serverId);
  const databases = cleanDatabases(data.databases);
  if (databases.length === 0) throw HttpError.badRequest("Selecciona al menos una base de datos");
  const environment = await resolveEnvironment(data.serverId, data.credentialId);
  const { databases: _omit, ...fields } = data;
  const options = normalizeExcludeSchemas(applyRetention(data.options, data.method), databases);
  const id = await repo.insertJob({ ...fields, options, environment }, databases);
  return getJob(id);
}

export async function updateJob(id: string, data: Partial<JobData>): Promise<BackupJobDto> {
  const current = await repo.findJobById(id);
  if (!current) throw HttpError.notFound("Evento de backup no encontrado");
  await validateRefs(data);
  if (data.bucketId !== undefined && data.bucketId !== current.bucketId) await assertActiveBucket(data.bucketId);
  let databases: string[] | undefined;
  if (data.databases) {
    databases = cleanDatabases(data.databases);
    if (databases.length === 0) throw HttpError.badRequest("Selecciona al menos una base de datos");
  }
  // Recalcula el ambiente con la instancia/credencial resultantes y revalida.
  const serverId = data.serverId ?? current.serverId;
  if ((data.method ?? current.method) === "cloudsql_export") {
    await assertCloudSqlExport(serverId, data.bucketId !== undefined ? data.bucketId : current.bucketId);
  } else {
    await assertDumpable(serverId);
  }
  const credentialId = data.credentialId !== undefined ? data.credentialId : current.credentialId;
  const environment = await resolveEnvironment(serverId, credentialId);
  const { databases: _omit, ...fields } = data;
  // Recalcula si cambian las opciones, el método (al pasar a bucket se quita la
  // retención) o las BDs (se descartan esquemas excluidos de BDs ya no incluidas).
  if (data.options !== undefined || data.method !== undefined || databases) {
    fields.options = normalizeExcludeSchemas(
      applyRetention(data.options ?? current.options, data.method ?? current.method),
      databases ?? current.databases,
    );
  }
  await repo.updateJob(id, { ...fields, environment }, databases);
  return getJob(id);
}

export async function deleteJob(id: string): Promise<void> {
  if (!(await repo.findJobById(id))) throw HttpError.notFound("Evento de backup no encontrado");
  await repo.deleteJob(id);
}

/**
 * Lanza el evento ahora: crea la ejecución (origen manual) con un ítem por BD en
 * estado `pending` y la pone en cola (arranca en cuanto haya hueco y la instancia
 * esté libre). Devuelve la ejecución recién creada (aún `pending`); el front
 * refresca para ver el progreso.
 */
export async function runNow(jobId: string): Promise<ExecutionDto> {
  const job = await getJob(jobId);
  const execId = await repo.createExecution(jobId, job.name, job.environment, job.databases);
  const exec = await repo.findExecutionById(execId);
  if (!exec) throw HttpError.notFound("Ejecución no encontrada");
  // El motor actualiza los estados en la BD; los errores se reflejan en la propia
  // ejecución y se loguean dentro del runner.
  enqueueExecution();
  return exec;
}

export async function listExecutions(p: { limit: number; offset: number; jobId?: string }) {
  return repo.listExecutions(p);
}

/** Igual que `runNow` pero marca la ejecución como `scheduled` (la usa el scheduler). */
export async function runScheduled(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  const execId = await repo.createExecution(jobId, job.name, job.environment, job.databases, "scheduled");
  enqueueExecution();
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
  enqueueExecution();
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
  if (item.prunedAt) throw HttpError.notFound("El backup se eliminó por la política de retención");
  if (!item.fileName) throw HttpError.badRequest("Esta base de datos no generó un archivo");

  // Objeto en GCS: resolver credenciales por el bucket y servir por streaming.
  if (item.fileName.startsWith("gs://")) {
    const parsed = parseGcsUri(item.fileName);
    if (!parsed) throw HttpError.badRequest("URI de backup inválida");
    const target = await storageRepo.findBucketByName(parsed.bucket);
    const serviceAccountJson = target?.cloudCredentialId
      ? await getServiceAccountJson(target.cloudCredentialId)
      : null;
    return {
      kind: "gcs",
      bucket: parsed.bucket,
      object: parsed.object,
      serviceAccountJson,
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
