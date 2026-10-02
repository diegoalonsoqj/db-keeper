import type { BackupJobDto, BackupMethod, ExecutionDto } from "@dbkeeper/shared";
import { pool, query } from "../../db/pool.js";

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

export async function listJobs(p: {
  limit: number;
  offset: number;
}): Promise<{ items: BackupJobDto[]; total: number }> {
  const totalRes = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM core.backup_jobs",
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const { rows } = await query<JobRow>(
    `${SELECT_JOB} GROUP BY j.id, s.name, c.name, b.name ORDER BY j.name LIMIT $1 OFFSET $2`,
    [p.limit, p.offset],
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
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  items: ExecutionDto["items"];
}

function toExecutionDto(row: ExecutionRow): ExecutionDto {
  return {
    id: row.id,
    jobId: row.job_id,
    label: row.label,
    environment: row.environment,
    status: row.status,
    origin: row.origin,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    items: row.items,
  };
}

const SELECT_EXECUTION = `
  SELECT e.*,
    COALESCE(
      json_agg(
        json_build_object(
          'id', i.id, 'dbName', i.db_name, 'status', i.status,
          'fileName', i.file_name, 'fileBytes', i.file_bytes, 'log', i.log,
          'startedAt', i.started_at, 'finishedAt', i.finished_at, 'prunedAt', i.pruned_at
        ) ORDER BY i.db_name
      ) FILTER (WHERE i.id IS NOT NULL), '[]'
    ) AS items
  FROM core.executions e
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
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO core.executions (job_id, label, environment, origin) VALUES ($1,$2,$3,$4) RETURNING id",
      [jobId, label, environment, origin],
    );
    const id = rows[0]!.id;
    if (databases.length > 0) {
      await client.query(
        `INSERT INTO core.execution_items (execution_id, db_name)
         SELECT $1, n FROM unnest($2::text[]) AS n`,
        [id, databases],
      );
    }
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function findExecutionById(id: string): Promise<ExecutionDto | null> {
  const { rows } = await query<ExecutionRow>(`${SELECT_EXECUTION} WHERE e.id = $1 GROUP BY e.id`, [id]);
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

/** Marca la ejecución como `running` y fija started_at si aún no estaba. */
export async function markExecutionRunning(id: string): Promise<void> {
  await query(
    "UPDATE core.executions SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1",
    [id],
  );
}

/** Cierra la ejecución con su estado final (`success`/`failed`) y finished_at. */
export async function finishExecution(id: string, status: "success" | "failed"): Promise<void> {
  await query("UPDATE core.executions SET status = $2, finished_at = now() WHERE id = $1", [id, status]);
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
  result: { status: "success" | "failed"; fileName?: string | null; fileBytes?: number | null; log?: string | null },
): Promise<void> {
  await query(
    `UPDATE core.execution_items
     SET status = $2, file_name = $3, file_bytes = $4, log = $5, finished_at = now()
     WHERE id = $1`,
    [itemId, result.status, result.fileName ?? null, result.fileBytes ?? null, result.log ?? null],
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
 * cualquier corrida en curso. Marca como `failed` toda ejecución/ítem que haya
 * quedado en `pending`/`running`, salvo las de `exceptIds` (se retoman).
 * Devuelve cuántas ejecuciones se cerraron.
 */
export async function recoverStaleExecutions(exceptIds: string[] = []): Promise<number> {
  await query(
    "UPDATE core.execution_items SET status = 'failed', finished_at = now(), " +
      "log = COALESCE(log, 'Interrumpida por reinicio del servicio') " +
      "WHERE status IN ('pending', 'running') AND execution_id <> ALL($1::uuid[])",
    [exceptIds],
  );
  const { rowCount } = await query(
    "UPDATE core.executions SET status = 'failed', finished_at = now() " +
      "WHERE status IN ('pending', 'running') AND id <> ALL($1::uuid[])",
    [exceptIds],
  );
  return rowCount ?? 0;
}

export async function listExecutions(p: {
  limit: number;
  offset: number;
  jobId?: string;
}): Promise<{ items: ExecutionDto[]; total: number }> {
  const where = p.jobId ? "WHERE e.job_id = $3" : "";
  const whereCount = p.jobId ? "WHERE job_id = $1" : "";
  const totalRes = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM core.executions ${whereCount}`,
    p.jobId ? [p.jobId] : [],
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const params: unknown[] = [p.limit, p.offset];
  if (p.jobId) params.push(p.jobId);
  const { rows } = await query<ExecutionRow>(
    `${SELECT_EXECUTION} ${where} GROUP BY e.id ORDER BY e.created_at DESC LIMIT $1 OFFSET $2`,
    params,
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
 * Ítems exitosos con archivo presente (no purgado) de un evento que violan la
 * política de retención: pertenecen a una ejecución más antigua que `days` **o**
 * que queda fuera de las `keepLast` corridas exitosas más recientes. Cada regla
 * es opcional (null = no se aplica esa dimensión); si ambas son null, no devuelve nada.
 */
export async function findPrunableItems(
  jobId: string,
  policy: { days: number | null; keepLast: number | null },
): Promise<PrunableItem[]> {
  if (policy.days == null && policy.keepLast == null) return [];
  const { rows } = await query<{ id: string; file_name: string }>(
    `WITH ranked AS (
       SELECT e.id, e.created_at,
              row_number() OVER (ORDER BY e.created_at DESC) AS rn
       FROM core.executions e
       WHERE e.job_id = $1 AND e.status = 'success'
     )
     SELECT i.id, i.file_name
     FROM core.execution_items i
     JOIN ranked r ON r.id = i.execution_id
     WHERE i.status = 'success' AND i.file_name IS NOT NULL AND i.pruned_at IS NULL
       -- La retención solo aplica al almacenamiento local: en buckets la app no borra
       -- (la limpieza se gestiona con el ciclo de vida del bucket en GCS).
       AND i.file_name NOT LIKE 'gs://%'
       AND ( ($2::int IS NOT NULL AND r.rn > $2::int)
          OR ($3::int IS NOT NULL AND r.created_at < now() - make_interval(days => $3::int)) )`,
    [jobId, policy.keepLast, policy.days],
  );
  return rows.map((r) => ({ id: r.id, fileName: r.file_name }));
}

/** Marca un ítem como purgado (su archivo físico ya se borró). */
export async function markItemPruned(itemId: string): Promise<void> {
  await query("UPDATE core.execution_items SET pruned_at = now() WHERE id = $1", [itemId]);
}

/** IDs de eventos que tienen alguna regla de retención configurada en options. */
export async function listJobIdsWithRetention(): Promise<string[]> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM core.backup_jobs
     WHERE (options #>> '{retention,days}') IS NOT NULL
        OR (options #>> '{retention,keepLast}') IS NOT NULL`,
  );
  return rows.map((r) => r.id);
}
