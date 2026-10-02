import type { ScheduleDto, ScheduleMode } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

interface Row {
  id: string;
  job_id: string;
  mode: ScheduleMode;
  run_at: Date | null;
  cron: string | null;
  timezone: string;
  is_active: boolean;
  next_run_at: Date | null;
  last_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: Row): ScheduleDto {
  return {
    id: row.id,
    jobId: row.job_id,
    mode: row.mode,
    runAt: row.run_at?.toISOString() ?? null,
    cron: row.cron,
    timezone: row.timezone,
    isActive: row.is_active,
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function findByJob(jobId: string): Promise<ScheduleDto | null> {
  const { rows } = await query<Row>("SELECT * FROM core.backup_schedules WHERE job_id = $1", [jobId]);
  return rows[0] ? toDto(rows[0]) : null;
}

export interface ScheduleFields {
  mode: ScheduleMode;
  runAt: Date | null;
  cron: string | null;
  timezone: string;
  isActive: boolean;
  nextRunAt: Date | null;
}

/** Crea o reemplaza la programación de un evento (una por evento). */
export async function upsert(jobId: string, f: ScheduleFields): Promise<ScheduleDto> {
  const { rows } = await query<Row>(
    `INSERT INTO core.backup_schedules (job_id, mode, run_at, cron, timezone, is_active, next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (job_id) DO UPDATE SET
       mode = EXCLUDED.mode, run_at = EXCLUDED.run_at, cron = EXCLUDED.cron,
       timezone = EXCLUDED.timezone, is_active = EXCLUDED.is_active,
       next_run_at = EXCLUDED.next_run_at, last_run_at = NULL
     RETURNING *`,
    [jobId, f.mode, f.runAt, f.cron, f.timezone, f.isActive, f.nextRunAt],
  );
  return toDto(rows[0]!);
}

export async function deleteByJob(jobId: string): Promise<void> {
  await query("DELETE FROM core.backup_schedules WHERE job_id = $1", [jobId]);
}

/** Programaciones activas cuyo próximo disparo ya venció. */
export async function findDue(now: Date): Promise<ScheduleDto[]> {
  const { rows } = await query<Row>(
    "SELECT * FROM core.backup_schedules WHERE is_active = true AND next_run_at IS NOT NULL AND next_run_at <= $1",
    [now],
  );
  return rows.map(toDto);
}

/**
 * Reserva el disparo de forma atómica: fija last_run_at y el próximo next_run_at
 * (o desactiva) **solo si** next_run_at sigue siendo el leído. Si otro proceso ya
 * la disparó, no actualiza nada y devuelve false (evita backups duplicados).
 */
export async function claimRun(
  id: string,
  expectedNextRunAt: Date,
  opts: { lastRunAt: Date; nextRunAt: Date | null; isActive: boolean },
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE core.backup_schedules SET last_run_at = $2, next_run_at = $3, is_active = $4
     WHERE id = $1 AND is_active = true AND date_trunc('milliseconds', next_run_at) = $5`,
    [id, opts.lastRunAt, opts.nextRunAt, opts.isActive, expectedNextRunAt],
  );
  return (rowCount ?? 0) > 0;
}
