import { query } from "../../db/pool.js";

/** Programación recurrente que cubre a un evento (propia o de un grupo activo). */
export interface WatchedSchedule {
  jobId: string;
  jobName: string;
  cron: string;
  timezone: string;
  /** Desde cuándo rige (no se exigen backups de disparos anteriores). */
  since: Date;
  /** Último disparo ya avisado (null si nunca). */
  alertedFireAt: Date | null;
}

/**
 * Eventos activos con BD y con programación recurrente activa, propia o heredada de un
 * grupo activo. Una fila por programación (un evento puede tener varias).
 */
export async function findWatchedSchedules(): Promise<WatchedSchedule[]> {
  const { rows } = await query<{
    job_id: string;
    job_name: string;
    cron: string;
    timezone: string;
    since: Date;
    alerted_fire_at: Date | null;
  }>(
    `WITH jobs AS (
       SELECT j.id, j.name, j.created_at, a.fire_at AS alerted_fire_at
       FROM core.backup_jobs j LEFT JOIN core.job_stale_alerts a ON a.job_id = j.id
       WHERE j.is_active AND EXISTS (SELECT 1 FROM core.backup_job_databases d WHERE d.job_id = j.id)
     )
     SELECT j.id AS job_id, j.name AS job_name, s.cron, s.timezone,
            GREATEST(j.created_at, s.created_at) AS since, j.alerted_fire_at
     FROM jobs j JOIN core.backup_schedules s ON s.job_id = j.id
     WHERE s.is_active AND s.mode = 'recurring'
     UNION ALL
     -- updated_at del grupo: cambia al editar sus miembros (un evento recién agregado
     -- no debe los disparos anteriores).
     SELECT j.id, j.name, s.cron, s.timezone,
            GREATEST(j.created_at, s.created_at, g.updated_at), j.alerted_fire_at
     FROM jobs j
     JOIN core.job_group_members m ON m.job_id = j.id
     JOIN core.job_groups g ON g.id = m.group_id AND g.is_active
     JOIN core.backup_schedules s ON s.group_id = g.id
     WHERE s.is_active AND s.mode = 'recurring'`,
  );
  return rows.map((r) => ({
    jobId: r.job_id,
    jobName: r.job_name,
    cron: r.cron,
    timezone: r.timezone,
    since: r.since,
    alertedFireAt: r.alerted_fire_at,
  }));
}

/** Estado de cada evento desde su último disparo esperado. */
export interface FireStatus {
  jobId: string;
  /** Hubo un backup correcto creado desde el disparo. */
  succeeded: boolean;
  /** Hay una ejecución en cola o en curso creada desde el disparo. */
  inProgress: boolean;
  /** Último backup correcto (cualquier fecha), para el aviso. */
  lastSuccessAt: Date | null;
}

/** Consulta en lote: (evento, disparo) → ¿hubo éxito / sigue en curso? */
export async function findFireStatus(checks: { jobId: string; fireAt: Date }[]): Promise<FireStatus[]> {
  if (checks.length === 0) return [];
  const { rows } = await query<{ job_id: string; succeeded: boolean; in_progress: boolean; last_success_at: Date | null }>(
    `SELECT c.job_id,
            EXISTS (SELECT 1 FROM core.executions e
                    WHERE e.job_id = c.job_id AND e.status = 'success' AND e.created_at >= c.fire_at) AS succeeded,
            EXISTS (SELECT 1 FROM core.executions e
                    WHERE e.job_id = c.job_id AND e.status IN ('pending', 'running') AND e.created_at >= c.fire_at) AS in_progress,
            (SELECT max(e.finished_at) FROM core.executions e
             WHERE e.job_id = c.job_id AND e.status = 'success') AS last_success_at
     FROM unnest($1::uuid[], $2::timestamptz[]) AS c(job_id, fire_at)`,
    [checks.map((c) => c.jobId), checks.map((c) => c.fireAt)],
  );
  return rows.map((r) => ({
    jobId: r.job_id,
    succeeded: r.succeeded,
    inProgress: r.in_progress,
    lastSuccessAt: r.last_success_at,
  }));
}

/** Registra el disparo avisado de cada evento (no se repite el aviso del mismo disparo). */
export async function markStaleAlerted(alerts: { jobId: string; fireAt: Date }[]): Promise<void> {
  if (alerts.length === 0) return;
  await query(
    `INSERT INTO core.job_stale_alerts (job_id, fire_at)
     SELECT * FROM unnest($1::uuid[], $2::timestamptz[])
     ON CONFLICT (job_id) DO UPDATE SET fire_at = EXCLUDED.fire_at, alerted_at = now()`,
    [alerts.map((a) => a.jobId), alerts.map((a) => a.fireAt)],
  );
}
