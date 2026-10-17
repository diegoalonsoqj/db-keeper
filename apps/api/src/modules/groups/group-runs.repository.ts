import type { ExecutionState, GroupNotifyMode } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

/** Modo de avisos de la corrida de grupo de una ejecución (null si no la lanzó un grupo). */
export async function findNotifyModeForExecution(executionId: string): Promise<GroupNotifyMode | null> {
  const { rows } = await query<{ notify_mode: GroupNotifyMode }>(
    `SELECT gr.notify_mode FROM core.executions e
     JOIN core.group_runs gr ON gr.id = e.group_run_id
     WHERE e.id = $1`,
    [executionId],
  );
  return rows[0]?.notify_mode ?? null;
}

export interface ClaimedGroupRun {
  id: string;
  groupName: string;
  origin: string;
  skipped: string[];
  createdAt: Date;
  finishedAt: Date;
}

/**
 * Reclama las corridas de grupo cuyas ejecuciones ya terminaron todas y que aún no
 * enviaron su resumen. El UPDATE condicional sobre `summary_sent_at IS NULL` garantiza
 * un solo envío aunque dos pasadas (o dos instancias) lleguen a la vez.
 */
export async function claimFinishedRuns(): Promise<ClaimedGroupRun[]> {
  const { rows } = await query<{
    id: string;
    group_name: string;
    origin: string;
    skipped: string[];
    created_at: Date;
    finished_at: Date;
  }>(
    `UPDATE core.group_runs gr
     SET summary_sent_at = now(),
         finished_at = COALESCE(
           (SELECT max(e.finished_at) FROM core.executions e WHERE e.group_run_id = gr.id), now())
     WHERE gr.summary_sent_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM core.executions e
                       WHERE e.group_run_id = gr.id AND e.status IN ('pending', 'running'))
     RETURNING gr.id, gr.group_name, gr.origin, gr.skipped, gr.created_at, gr.finished_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    groupName: r.group_name,
    origin: r.origin,
    skipped: r.skipped,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  }));
}

/** Ejecución de la corrida, con lo necesario para su línea en el resumen. */
export interface GroupRunExecution {
  executionId: string;
  label: string;
  status: ExecutionState;
  startedAt: Date | null;
  finishedAt: Date | null;
  dbCount: number;
  totalBytes: number;
  /** Primera BD fallida y su log (null si no falló ninguna). */
  failedDb: string | null;
  failedLog: string | null;
}

/** Ejecuciones de una corrida en orden de cola. */
export async function findRunExecutions(runId: string): Promise<GroupRunExecution[]> {
  const { rows } = await query<{
    id: string;
    label: string;
    status: ExecutionState;
    started_at: Date | null;
    finished_at: Date | null;
    db_count: string;
    total_bytes: string | null;
    failed_db: string | null;
    failed_log: string | null;
  }>(
    `SELECT e.id, e.label, e.status, e.started_at, e.finished_at,
            count(i.id)::text AS db_count,
            sum(i.file_bytes) FILTER (WHERE i.status = 'success')::text AS total_bytes,
            (array_agg(i.db_name ORDER BY i.db_name) FILTER (WHERE i.status = 'failed'))[1] AS failed_db,
            (array_agg(i.log ORDER BY i.db_name) FILTER (WHERE i.status = 'failed'))[1] AS failed_log
     FROM core.executions e
     LEFT JOIN core.execution_items i ON i.execution_id = e.id
     WHERE e.group_run_id = $1
     GROUP BY e.id
     ORDER BY e.created_at`,
    [runId],
  );
  return rows.map((r) => ({
    executionId: r.id,
    label: r.label,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    dbCount: Number(r.db_count),
    totalBytes: Number(r.total_bytes ?? 0),
    failedDb: r.failed_db,
    failedLog: r.failed_log,
  }));
}
