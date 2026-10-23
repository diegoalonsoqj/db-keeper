import type { ScheduleDto, ScheduleMode } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

interface Row {
  id: string;
  job_id: string | null;
  group_id: string | null;
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
    groupId: row.group_id,
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

/** A quién pertenece una programación: un evento o un grupo. */
export type ScheduleTarget = { jobId: string } | { groupId: string };

/** Columna y valor del dueño (nombres fijos: no vienen del cliente). */
function targetColumn(t: ScheduleTarget): { col: "job_id" | "group_id"; id: string } {
  return "jobId" in t ? { col: "job_id", id: t.jobId } : { col: "group_id", id: t.groupId };
}

export async function findByTarget(target: ScheduleTarget): Promise<ScheduleDto | null> {
  const { col, id } = targetColumn(target);
  const { rows } = await query<Row>(`SELECT * FROM core.backup_schedules WHERE ${col} = $1`, [id]);
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

/** Crea o reemplaza la programación de un evento o grupo (una por cada uno). */
export async function upsert(target: ScheduleTarget, f: ScheduleFields): Promise<ScheduleDto> {
  const { col, id } = targetColumn(target);
  const { rows } = await query<Row>(
    `INSERT INTO core.backup_schedules (${col}, mode, run_at, cron, timezone, is_active, next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (${col}) DO UPDATE SET
       mode = EXCLUDED.mode, run_at = EXCLUDED.run_at, cron = EXCLUDED.cron,
       timezone = EXCLUDED.timezone, is_active = EXCLUDED.is_active,
       next_run_at = EXCLUDED.next_run_at, last_run_at = NULL
     RETURNING *`,
    [id, f.mode, f.runAt, f.cron, f.timezone, f.isActive, f.nextRunAt],
  );
  return toDto(rows[0]!);
}

/** Nombre actual del grupo o evento de una programación (null si ya no existe). */
export async function findTargetName(target: ScheduleTarget): Promise<string | null> {
  const sql =
    "jobId" in target
      ? "SELECT name FROM core.backup_jobs WHERE id = $1"
      : "SELECT name FROM core.job_groups WHERE id = $1";
  const { rows } = await query<{ name: string }>(sql, ["jobId" in target ? target.jobId : target.groupId]);
  return rows[0]?.name ?? null;
}

export async function deleteByTarget(target: ScheduleTarget): Promise<void> {
  const { col, id } = targetColumn(target);
  await query(`DELETE FROM core.backup_schedules WHERE ${col} = $1`, [id]);
}

/**
 * Programaciones que dispararían a la vez que la del grupo y comparten eventos con él:
 * otros grupos con algún evento en común, o la programación propia de uno de sus
 * eventos. Esos eventos se ejecutarían dos veces seguidas (la cola nunca los solapa).
 */
export async function findOverlapsForGroup(groupId: string, nextRunAt: Date): Promise<string[]> {
  const { rows } = await query<{ label: string }>(
    `SELECT 'grupo ' || g.name AS label
     FROM core.backup_schedules s
     JOIN core.job_groups g ON g.id = s.group_id
     WHERE s.is_active AND s.group_id <> $1 AND s.next_run_at = $2
       AND EXISTS (SELECT 1 FROM core.job_group_members a
                   JOIN core.job_group_members b ON b.job_id = a.job_id
                   WHERE a.group_id = $1 AND b.group_id = s.group_id)
     UNION ALL
     SELECT 'evento ' || j.name
     FROM core.backup_schedules s
     JOIN core.backup_jobs j ON j.id = s.job_id
     JOIN core.job_group_members m ON m.job_id = s.job_id AND m.group_id = $1
     WHERE s.is_active AND s.next_run_at = $2
     ORDER BY 1`,
    [groupId, nextRunAt],
  );
  return rows.map((r) => r.label);
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
