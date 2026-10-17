import {
  parseExecutionCode,
  type BackupJobDto,
  type BackupMethod,
  type ExecutionDto,
  type ExecutionOrigin,
  type ExecutionSort,
  type ExecutionState,
  type FileChecksums,
  type JobSort,
  type SortDir,
  type VerifyMode,
  type VerifyStatus,
} from "@dbkeeper/shared";
import { pool, query } from "../../db/pool.js";
import { INSTANCE_HOST } from "../../lib/instance.js";
import { orderBy, SqlWhere } from "../../lib/list-query.js";

interface JobRow {
  id: string;
  name: string;
  server_id: string;
  server_name: string;
  credential_id: string | null;
  cred_name: string | null;
  method: BackupMethod;
  bucket_id: string | null;
  bucket_name: string | null;
  environment: string | null;
  options: Record<string, unknown>;
  is_active: boolean;
  databases: string[];
  created_at: Date;
  updated_at: Date;
}

function toJobDto(row: JobRow): BackupJobDto {
  return {
    id: row.id,
    name: row.name,
    serverId: row.server_id,
    serverName: row.server_name,
    credentialId: row.credential_id,
    credentialName: row.cred_name,
    method: row.method,
    bucketId: row.bucket_id,
    bucketName: row.bucket_name,
    environment: row.environment,
    options: row.options,
    isActive: row.is_active,
    databases: row.databases,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_JOB = `
  SELECT j.*, s.name AS server_name, c.name AS cred_name, b.name AS bucket_name,
    COALESCE(array_agg(jd.db_name ORDER BY jd.db_name) FILTER (WHERE jd.db_name IS NOT NULL), '{}')
      AS databases
  FROM core.backup_jobs j
  JOIN core.servers s ON s.id = j.server_id
  LEFT JOIN secrets.credentials c ON c.id = j.credential_id
  LEFT JOIN core.storage_targets b ON b.id = j.bucket_id
  LEFT JOIN core.backup_job_databases jd ON jd.job_id = j.id
`;

export interface JobListQuery {
  limit: number;
  offset: number;
  q?: string;
  serverId?: string;
  method?: BackupMethod;
  environment?: string;
  /** true = con programación activa; false = solo manual. */
  scheduled?: boolean;
  active?: boolean;
  sort?: JobSort;
  dir?: SortDir;
}

const JOB_ORDER: Record<JobSort, string> = {
  name: "lower(j.name)",
  server: "lower(s.name)",
  environment: "j.environment",
  method: "j.method",
  destination: "lower(b.name)",
  active: "j.is_active",
};

export async function listJobs(p: JobListQuery): Promise<{ items: BackupJobDto[]; total: number }> {
  const w = new SqlWhere()
    .eq("j.server_id", p.serverId)
    .eq("j.method", p.method)
    .eq("j.environment", p.environment)
    .eq("j.is_active", p.active)
    .search(["j.name"], p.q);
  if (p.scheduled !== undefined) {
    w.add(`${p.scheduled ? "" : "NOT "}EXISTS (SELECT 1 FROM core.backup_schedules bs WHERE bs.job_id = j.id AND bs.is_active)`);
  }
  const totalRes = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM core.backup_jobs j ${w.sql}`,
    w.params,
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const order = orderBy(JOB_ORDER, p.sort, p.dir, { sort: "name", dir: "asc" }, "j.id");
  const n = w.params.length;
  const { rows } = await query<JobRow>(
    `${SELECT_JOB} ${w.sql} GROUP BY j.id, s.name, c.name, b.name ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...w.params, p.limit, p.offset],
  );
  return { items: rows.map(toJobDto), total };
}

export async function findJobById(id: string): Promise<BackupJobDto | null> {
  const { rows } = await query<JobRow>(
    `${SELECT_JOB} WHERE j.id = $1 GROUP BY j.id, s.name, c.name, b.name`,
    [id],
  );
  return rows[0] ? toJobDto(rows[0]) : null;
}

export interface JobFields {
  name: string;
  serverId: string;
  credentialId: string | null;
  method: BackupMethod;
  bucketId: string | null;
  environment: string | null;
  options: Record<string, unknown>;
  isActive: boolean;
}

async function replaceDatabases(
  client: { query: typeof pool.query },
  jobId: string,
  names: string[],
): Promise<void> {
  await client.query("DELETE FROM core.backup_job_databases WHERE job_id = $1", [jobId]);
  if (names.length > 0) {
    await client.query(
      `INSERT INTO core.backup_job_databases (job_id, db_name)
       SELECT $1, n FROM unnest($2::text[]) AS n`,
      [jobId, names],
    );
  }
}

export async function insertJob(fields: JobFields, databases: string[]): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO core.backup_jobs (name, server_id, credential_id, method, bucket_id, environment, options, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        fields.name,
        fields.serverId,
        fields.credentialId,
        fields.method,
        fields.bucketId,
        fields.environment,
        fields.options,
        fields.isActive,
      ],
    );
    const id = rows[0]!.id;
    await replaceDatabases(client, id, databases);
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateJob(
  id: string,
  fields: Partial<JobFields>,
  databases?: string[],
): Promise<void> {
  const map: Record<string, string> = {
    name: "name",
    serverId: "server_id",
    credentialId: "credential_id",
    method: "method",
    bucketId: "bucket_id",
    environment: "environment",
    options: "options",
    isActive: "is_active",
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const [k, col] of Object.entries(map)) {
      const v = (fields as Record<string, unknown>)[k];
      if (v !== undefined) (sets.push(`${col} = $${i++}`), params.push(v));
    }
    if (sets.length > 0) {
      params.push(id);
      await client.query(`UPDATE core.backup_jobs SET ${sets.join(", ")} WHERE id = $${i}`, params);
    }
    if (databases) await replaceDatabases(client, id, databases);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteJob(id: string): Promise<void> {
  await query("DELETE FROM core.backup_jobs WHERE id = $1", [id]);
}

// ---- Ejecuciones ----

interface ExecutionRow {
  id: string;
  job_id: string | null;
  label: string;
  environment: string | null;
  status: ExecutionDto["status"];
  origin: ExecutionDto["origin"];
  group_id: string | null;
  group_name: string | null;
  runner_host: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  method: ExecutionDto["method"];
  items: ExecutionDto["items"];
}

function toExecutionDto(row: ExecutionRow): ExecutionDto {
  return {
    id: row.id,
    jobId: row.job_id,
    method: row.method ?? null,
    label: row.label,
    environment: row.environment,
    status: row.status,
    origin: row.origin,
    groupId: row.group_id,
    groupName: row.group_name,
    runnerHost: row.runner_host,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    items: row.items,
  };
}

const SELECT_EXECUTION = `
  SELECT e.*, j.method,
    COALESCE(
      json_agg(
        json_build_object(
          'id', i.id, 'dbName', i.db_name, 'status', i.status,
          'fileName', i.file_name, 'fileBytes', i.file_bytes, 'log', i.log,
          'startedAt', i.started_at, 'finishedAt', i.finished_at, 'prunedAt', i.pruned_at,
          'checksums', CASE WHEN COALESCE(i.file_sha256, i.file_md5, i.file_crc32c) IS NOT NULL
            THEN json_build_object('sha256', i.file_sha256, 'md5', i.file_md5, 'crc32c', i.file_crc32c) END,
          'verification', CASE WHEN i.verify_status IS NOT NULL
            THEN json_build_object('status', i.verify_status, 'mode', i.verify_mode,
              'at', i.verified_at, 'detail', i.verify_detail) END
        ) ORDER BY i.db_name
      ) FILTER (WHERE i.id IS NOT NULL), '[]'
    ) AS items
  FROM core.executions e
  LEFT JOIN core.backup_jobs j ON j.id = e.job_id
  LEFT JOIN core.execution_items i ON i.execution_id = e.id
`;

export async function createExecution(
  jobId: string,
  label: string,
  environment: string | null,
  databases: string[],
  origin: ExecutionDto["origin"] = "manual",
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = await insertExecution(client, { jobId, label, environment, databases, origin, group: null });
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface NewExecution {
  jobId: string;
  label: string;
  environment: string | null;
  databases: string[];
  origin: ExecutionDto["origin"];
  /** Grupo que la lanza (id + nombre snapshot + corrida), o null. */
  group: { id: string; name: string; runId: string } | null;
}

/**
 * Inserta una ejecución `pending` con un ítem por BD, dentro de la transacción del
 * llamador. `created_at` usa clock_timestamp(): varias creadas en la misma transacción
 * (un grupo) quedan en la cola en el orden en que se insertan.
 */
export async function insertExecution(client: { query: typeof pool.query }, e: NewExecution): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.executions (job_id, label, environment, origin, group_id, group_name, group_run_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, clock_timestamp()) RETURNING id`,
    [e.jobId, e.label, e.environment, e.origin, e.group?.id ?? null, e.group?.name ?? null, e.group?.runId ?? null],
  );
  const id = rows[0]!.id;
  if (e.databases.length > 0) {
    await client.query(
      `INSERT INTO core.execution_items (execution_id, db_name)
       SELECT $1, n FROM unnest($2::text[]) AS n`,
      [id, e.databases],
    );
  }
  return id;
}

export async function findExecutionById(id: string): Promise<ExecutionDto | null> {
  const { rows } = await query<ExecutionRow>(`${SELECT_EXECUTION} WHERE e.id = $1 GROUP BY e.id, j.method`, [id]);
  return rows[0] ? toExecutionDto(rows[0]) : null;
}

/** Devuelve el archivo de un ítem (para descarga), validando que pertenezca a la ejecución. */
export async function findItemFile(
  executionId: string,
  itemId: string,
): Promise<{ fileName: string | null; dbName: string; status: ExecutionDto["status"]; prunedAt: Date | null } | null> {
  const { rows } = await query<{ file_name: string | null; db_name: string; status: ExecutionDto["status"]; pruned_at: Date | null }>(
    "SELECT file_name, db_name, status, pruned_at FROM core.execution_items WHERE id = $1 AND execution_id = $2",
    [itemId, executionId],
  );
  return rows[0]
    ? { fileName: rows[0].file_name, dbName: rows[0].db_name, status: rows[0].status, prunedAt: rows[0].pruned_at }
    : null;
}

// ---- Transiciones de estado (motor, fase 2) ----

/**
 * Toma una ejecución de la cola: `pending` → `running` de forma atómica. Devuelve false
 * si otro proceso ya la tomó o se canceló (no se debe ejecutar).
 */
export async function claimExecution(id: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE core.executions
     SET status = 'running', started_at = COALESCE(started_at, now()), runner_host = $2
     WHERE id = $1 AND status = 'pending'`,
    [id, INSTANCE_HOST],
  );
  return rowCount === 1;
}

/** Marca la ejecución como `running` y fija started_at si aún no estaba. */
export async function markExecutionRunning(id: string): Promise<void> {
  await query(
    `UPDATE core.executions
     SET status = 'running', started_at = COALESCE(started_at, now()), runner_host = $2
     WHERE id = $1`,
    [id, INSTANCE_HOST],
  );
}

/**
 * Cancela una ejecución que sigue en cola (`pending`): la cierra como fallida con
 * el motivo en cada ítem. Condicional: si la cola ya la lanzó, no hace nada (false).
 */
export async function cancelPendingExecution(id: string, reason: string): Promise<boolean> {
  // Una sola sentencia: ejecución e ítems se cierran juntos o no se cierra nada.
  const { rows } = await query<{ n: string }>(
    `WITH e AS (
       UPDATE core.executions SET status = 'failed', finished_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING id
     ), i AS (
       UPDATE core.execution_items SET status = 'failed', log = $2, finished_at = now()
       WHERE execution_id IN (SELECT id FROM e) AND status = 'pending' RETURNING 1
     )
     SELECT count(*)::text AS n FROM e`,
    [id, reason],
  );
  return rows[0]?.n === "1";
}

/** Cierra la ejecución con su estado final (`success`/`failed`) y finished_at. */
export async function finishExecution(id: string, status: "success" | "failed"): Promise<void> {
  // runner_host también aquí: las que fallan antes de arrancar no pasan por markExecutionRunning.
  await query(
    "UPDATE core.executions SET status = $2, finished_at = now(), runner_host = COALESCE(runner_host, $3) WHERE id = $1",
    [id, status, INSTANCE_HOST],
  );
}

/** Marca un ítem (BD) como `running` con started_at. */
export async function markItemRunning(itemId: string): Promise<void> {
  await query(
    "UPDATE core.execution_items SET status = 'running', started_at = now() WHERE id = $1",
    [itemId],
  );
}

/** Cierra un ítem con su resultado: estado final, archivo/peso y log. */
export async function finishItem(
  itemId: string,
  result: {
    status: "success" | "failed";
    fileName?: string | null;
    fileBytes?: number | null;
    log?: string | null;
    checksums?: FileChecksums | null;
    /** Copia conservada en disco de un backup subido a bucket (keepLocalCopy). */
    localFileName?: string | null;
  },
): Promise<void> {
  const c = result.checksums;
  await query(
    `UPDATE core.execution_items
     SET status = $2, file_name = $3, file_bytes = $4, log = $5,
         file_sha256 = $6, file_md5 = $7, file_crc32c = $8, local_file_name = $9, finished_at = now()
     WHERE id = $1`,
    [
      itemId,
      result.status,
      result.fileName ?? null,
      result.fileBytes ?? null,
      result.log ?? null,
      c?.sha256 ?? null,
      c?.md5 ?? null,
      c?.crc32c ?? null,
      result.localFileName ?? null,
    ],
  );
}

/**
 * Registra la operación de Cloud SQL lanzada para un ítem, junto con su destino y
 * el log hasta ese momento, para poder retomarla tras un reinicio.
 */
export async function setItemOperation(itemId: string, operation: string, fileName: string, log: string | null): Promise<void> {
  await query(
    "UPDATE core.execution_items SET cloudsql_operation = $2, file_name = $3, log = $4 WHERE id = $1",
    [itemId, operation, fileName, log],
  );
}

/** Persiste el log parcial de un ítem que sigue en curso (export en verificación). */
export async function updateItemLog(itemId: string, log: string | null): Promise<void> {
  await query("UPDATE core.execution_items SET log = $2 WHERE id = $1", [itemId, log]);
}

/** Operaciones de Cloud SQL registradas por ítem de una ejecución (itemId → operación). */
export async function findItemOperations(executionId: string): Promise<Map<string, string>> {
  const { rows } = await query<{ id: string; cloudsql_operation: string }>(
    "SELECT id, cloudsql_operation FROM core.execution_items WHERE execution_id = $1 AND cloudsql_operation IS NOT NULL",
    [executionId],
  );
  return new Map(rows.map((r) => [r.id, r.cloudsql_operation]));
}

/** Ejecuciones de export de Cloud SQL que quedaron en curso: se pueden retomar. */
export async function findResumableExecutionIds(): Promise<string[]> {
  const { rows } = await query<{ id: string }>(
    `SELECT e.id FROM core.executions e
     JOIN core.backup_jobs j ON j.id = e.job_id
     WHERE e.status = 'running' AND j.method = 'cloudsql_export'`,
  );
  return rows.map((r) => r.id);
}

/**
 * Recupera ejecuciones huérfanas: en el modelo en-proceso, un reinicio mata
 * cualquier corrida en curso. Marca como `failed` las ejecuciones `running` (y sus
 * ítems sin cerrar), salvo las de `exceptIds` (se retoman). Las `pending` no se
 * tocan: son la cola y se lanzan al arrancar. Devuelve los ids cerrados.
 */
export async function recoverStaleExecutions(exceptIds: string[] = []): Promise<string[]> {
  const { rows } = await query<{ id: string }>(
    `WITH failed AS (
       UPDATE core.executions SET status = 'failed', finished_at = now()
       WHERE status = 'running' AND id <> ALL($1::uuid[])
       RETURNING id
     ), items AS (
       UPDATE core.execution_items SET status = 'failed', finished_at = now(),
         log = COALESCE(log, 'Interrumpida por reinicio del servicio')
       WHERE status IN ('pending', 'running') AND execution_id IN (SELECT id FROM failed)
       RETURNING 1
     )
     SELECT id FROM failed`,
    [exceptIds],
  );
  return rows.map((r) => r.id);
}

// ---- Verificación de integridad a demanda ----

/** Datos de un ítem para verificar su archivo (valida pertenencia a la ejecución). */
export interface ItemForVerify {
  dbName: string;
  status: ExecutionDto["status"];
  fileName: string | null;
  fileBytes: number | null;
  prunedAt: Date | null;
  checksums: FileChecksums;
  verifyStatus: VerifyStatus | null;
  jobName: string;
  engine: string | null;
  /** Para el aviso: mismo asunto (hilo) que la ejecución original. */
  executionId: string;
  executionCreatedAt: Date;
  serverName: string | null;
  groupName: string | null;
}

export async function findItemForVerify(executionId: string, itemId: string): Promise<ItemForVerify | null> {
  const { rows } = await query<{
    db_name: string;
    status: ExecutionDto["status"];
    file_name: string | null;
    file_bytes: string | null;
    pruned_at: Date | null;
    file_sha256: string | null;
    file_md5: string | null;
    file_crc32c: string | null;
    verify_status: VerifyStatus | null;
    job_name: string;
    engine: string | null;
    execution_created_at: Date;
    server_name: string | null;
    group_name: string | null;
  }>(
    `SELECT i.db_name, i.status, i.file_name, i.file_bytes, i.pruned_at,
            i.file_sha256, i.file_md5, i.file_crc32c, i.verify_status,
            COALESCE(j.name, e.label) AS job_name, s.engine,
            e.created_at AS execution_created_at, s.name AS server_name, e.group_name
     FROM core.execution_items i
     JOIN core.executions e ON e.id = i.execution_id
     LEFT JOIN core.backup_jobs j ON j.id = e.job_id
     LEFT JOIN core.servers s ON s.id = j.server_id
     WHERE i.id = $1 AND i.execution_id = $2`,
    [itemId, executionId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    dbName: r.db_name,
    status: r.status,
    fileName: r.file_name,
    fileBytes: r.file_bytes == null ? null : Number(r.file_bytes),
    prunedAt: r.pruned_at,
    checksums: { sha256: r.file_sha256, md5: r.file_md5, crc32c: r.file_crc32c },
    verifyStatus: r.verify_status,
    jobName: r.job_name,
    engine: r.engine,
    executionId,
    executionCreatedAt: r.execution_created_at,
    serverName: r.server_name,
    groupName: r.group_name,
  };
}

/** Marca el inicio de una verificación; false si ya había una en curso (atómico). */
export async function startItemVerify(itemId: string, mode: VerifyMode): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE core.execution_items
     SET verify_status = 'running', verify_mode = $2, verified_at = now(), verify_detail = NULL
     WHERE id = $1 AND verify_status IS DISTINCT FROM 'running'`,
    [itemId, mode],
  );
  return (rowCount ?? 0) > 0;
}

/** Guarda el resultado de una verificación. */
export async function finishItemVerify(
  itemId: string,
  status: Exclude<VerifyStatus, "running">,
  detail: string | null,
): Promise<void> {
  await query(
    "UPDATE core.execution_items SET verify_status = $2, verified_at = now(), verify_detail = $3 WHERE id = $1",
    [itemId, status, detail],
  );
}

/** Tras un reinicio: las verificaciones en curso murieron con el proceso. */
export async function recoverStaleVerifications(): Promise<number> {
  const { rowCount } = await query(
    `UPDATE core.execution_items
     SET verify_status = 'error', verify_detail = 'Interrumpida por reinicio del servicio', verified_at = now()
     WHERE verify_status = 'running'`,
  );
  return rowCount ?? 0;
}

export interface QueuedExecution {
  id: string;
  /** null si el evento ya no existe (la ejecución fallará al lanzarse). */
  serverId: string | null;
  method: string | null;
}

/** Cola: ejecuciones `pending` por orden de llegada, con su instancia y método. */
export async function listQueuedExecutions(limit = 200): Promise<QueuedExecution[]> {
  const { rows } = await query<{ id: string; server_id: string | null; method: string | null }>(
    `SELECT e.id, j.server_id, j.method
     FROM core.executions e
     LEFT JOIN core.backup_jobs j ON j.id = e.job_id
     WHERE e.status = 'pending'
     ORDER BY e.created_at
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ id: r.id, serverId: r.server_id, method: r.method }));
}

/** Instancias con alguna ejecución en curso (incluidos exports en verificación). */
export async function findBusyServerIds(): Promise<string[]> {
  const { rows } = await query<{ server_id: string }>(
    `SELECT DISTINCT j.server_id
     FROM core.executions e
     JOIN core.backup_jobs j ON j.id = e.job_id
     WHERE e.status = 'running'`,
  );
  return rows.map((r) => r.server_id);
}

export interface ExecutionListQuery {
  limit: number;
  offset: number;
  jobId?: string;
  groupId?: string;
  /** Nombre del evento o código de ejecución (`#3F2504E0`). */
  q?: string;
  status?: ExecutionState;
  origin?: ExecutionOrigin;
  environment?: string;
  /**
   * Rango sobre la creación, como en Auditoría: `from` = inicio del primer día y `to` =
   * inicio del último día (inclusivo), ambos en la zona del navegador.
   */
  from?: Date;
  to?: Date;
  sort?: ExecutionSort;
  dir?: SortDir;
}

const EXECUTION_ORDER: Record<ExecutionSort, string> = {
  created: "e.created_at",
  finished: "e.finished_at",
  label: "lower(e.label)",
  status: "e.status",
  environment: "e.environment",
  databases: "count(i.id)",
  duration: "(e.finished_at - e.started_at)",
  size: "sum(i.file_bytes)",
};

export async function listExecutions(p: ExecutionListQuery): Promise<{ items: ExecutionDto[]; total: number }> {
  const w = new SqlWhere().eq("e.job_id", p.jobId).eq("e.group_id", p.groupId).eq("e.status", p.status).eq("e.origin", p.origin).eq("e.environment", p.environment);
  if (p.from) w.add(`e.created_at >= ${w.param(p.from)}`);
  if (p.to) w.add(`e.created_at < ${w.param(p.to)}::timestamptz + interval '1 day'`);
  // El código del asunto de los avisos es el prefijo del id (sin guiones en sus 8 primeros caracteres).
  const code = p.q ? parseExecutionCode(p.q) : null;
  w.search(["e.label"], p.q, code ? [`e.id::text LIKE ${w.param(`${code}%`)}`] : []);

  const totalRes = await query<{ count: string }>(`SELECT count(*)::text AS count FROM core.executions e ${w.sql}`, w.params);
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const order = orderBy(EXECUTION_ORDER, p.sort, p.dir, { sort: "created", dir: "desc" }, "e.id");
  const n = w.params.length;
  const { rows } = await query<ExecutionRow>(
    `${SELECT_EXECUTION} ${w.sql} GROUP BY e.id, j.method ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...w.params, p.limit, p.offset],
  );
  return { items: rows.map(toExecutionDto), total };
}

// ---- Retención (parte 21) ----

/** Ítem con archivo aún vivo, candidato a purga por retención. */
export interface PrunableItem {
  id: string;
  fileName: string;
}

/**
 * Qué archivo se purga: `file` = el backup en disco (eventos locales); `local` = la
 * copia conservada en disco de un backup subido a bucket (keepLocalCopy). El objeto
 * del bucket nunca se toca.
 */
export type PruneTarget = "file" | "local";

/**
 * Ítems de un evento cuyo archivo en disco (aún no purgado) viola la retención: su
 * ejecución es más antigua que `days` **o** quedan fuera de los `keepLast` backups
 * correctos más recientes **de su misma base de datos**. Contar por BD (y no por
 * ejecución) hace que una ejecución con fallo parcial no deje backups sin purgar.
 * Cada regla es opcional (null = no se aplica); si ambas son null, no devuelve nada.
 */
export async function findPrunableItems(
  jobId: string,
  policy: { days: number | null; keepLast: number | null },
  target: PruneTarget = "file",
): Promise<PrunableItem[]> {
  if (policy.days == null && policy.keepLast == null) return [];
  // Columnas fijas según el destino (nunca vienen del cliente).
  const [fileCol, prunedCol, hasFile] =
    target === "local"
      ? ["i.local_file_name", "i.local_pruned_at", "i.local_file_name IS NOT NULL"]
      : ["i.file_name", "i.pruned_at", "i.file_name IS NOT NULL AND i.file_name NOT LIKE 'gs://%'"];
  const { rows } = await query<{ id: string; file_name: string }>(
    `WITH ranked AS (
       SELECT i.id, ${fileCol} AS file_name, ${prunedCol} AS pruned_at, e.created_at,
              row_number() OVER (PARTITION BY i.db_name ORDER BY e.created_at DESC) AS rn
       FROM core.execution_items i
       JOIN core.executions e ON e.id = i.execution_id
       -- En buckets la app no borra (ciclo de vida de GCS): solo archivos en disco.
       WHERE e.job_id = $1 AND i.status = 'success' AND ${hasFile}
     )
     SELECT id, file_name FROM ranked
     WHERE pruned_at IS NULL
       AND ( ($2::int IS NOT NULL AND rn > $2::int)
          OR ($3::int IS NOT NULL AND created_at < now() - make_interval(days => $3::int)) )`,
    [jobId, policy.keepLast, policy.days],
  );
  return rows.map((r) => ({ id: r.id, fileName: r.file_name }));
}

/** Marca un ítem como purgado (su archivo físico ya se borró). */
export async function markItemPruned(itemId: string, target: PruneTarget = "file"): Promise<void> {
  const col = target === "local" ? "local_pruned_at" : "pruned_at";
  await query(`UPDATE core.execution_items SET ${col} = now() WHERE id = $1`, [itemId]);
}

/**
 * Eventos a revisar en el barrido de retención: los que tienen regla propia y, si hay
 * retención por defecto, todos los que dejan archivos en disco (locales o con copia).
 */
export async function listJobIdsWithRetention(includeAllLocal = false): Promise<string[]> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM core.backup_jobs
     WHERE (options #>> '{retention,days}') IS NOT NULL
        OR (options #>> '{retention,keepLast}') IS NOT NULL
        OR ($1::boolean AND method IN ('dump', 'gcloud'))`,
    [includeAllLocal],
  );
  return rows.map((r) => r.id);
}

/**
 * Mayor tamaño entre los últimos backups exitosos de cada BD del evento (bytes), o
 * null sin historial. Dimensiona el disco temporal del dump paralelo.
 */
export async function findLastSuccessBytes(jobId: string, dbNames: string[]): Promise<number | null> {
  const { rows } = await query<{ bytes: string | null }>(
    `SELECT max(b)::text AS bytes FROM (
       SELECT DISTINCT ON (i.db_name) i.file_bytes AS b
       FROM core.execution_items i
       JOIN core.executions e ON e.id = i.execution_id
       WHERE e.job_id = $1 AND i.status = 'success' AND i.file_bytes IS NOT NULL AND i.db_name = ANY($2::text[])
       ORDER BY i.db_name, i.finished_at DESC
     ) t`,
    [jobId, dbNames],
  );
  return rows[0]?.bytes != null ? Number(rows[0].bytes) : null;
}
