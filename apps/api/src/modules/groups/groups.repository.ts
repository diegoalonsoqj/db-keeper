import type { BackupMethod, JobGroupDto, JobGroupMemberDto } from "@dbkeeper/shared";
import { pool, query } from "../../db/pool.js";
import { insertExecution } from "../backups/backups.repository.js";

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  next_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
  members: JobGroupMemberDto[];
}

function toDto(row: GroupRow): JobGroupDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    members: row.members,
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_GROUP = `
  SELECT g.*,
    (SELECT s.next_run_at FROM core.backup_schedules s WHERE s.group_id = g.id AND s.is_active) AS next_run_at,
    COALESCE((
      SELECT json_agg(json_build_object(
               'jobId', j.id, 'jobName', j.name, 'method', j.method,
               'serverId', j.server_id, 'serverName', sv.name, 'isActive', j.is_active,
               'hasOwnSchedule', EXISTS (SELECT 1 FROM core.backup_schedules js
                                         WHERE js.job_id = j.id AND js.is_active))
             ORDER BY m.position)
      FROM core.job_group_members m
      JOIN core.backup_jobs j ON j.id = m.job_id
      JOIN core.servers sv ON sv.id = j.server_id
      WHERE m.group_id = g.id
    ), '[]') AS members
  FROM core.job_groups g
`;

export async function listGroups(p: { limit: number; offset: number }): Promise<{ items: JobGroupDto[]; total: number }> {
  const totalRes = await query<{ count: string }>("SELECT count(*)::text AS count FROM core.job_groups");
  const { rows } = await query<GroupRow>(`${SELECT_GROUP} ORDER BY lower(g.name) LIMIT $1 OFFSET $2`, [
    p.limit,
    p.offset,
  ]);
  return { items: rows.map(toDto), total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function findById(id: string): Promise<JobGroupDto | null> {
  const { rows } = await query<GroupRow>(`${SELECT_GROUP} WHERE g.id = $1`, [id]);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function findIdByName(name: string): Promise<string | null> {
  const { rows } = await query<{ id: string }>("SELECT id FROM core.job_groups WHERE lower(name) = lower($1)", [name]);
  return rows[0]?.id ?? null;
}

/** Ids de evento que existen (para validar los miembros antes de guardar). */
export async function findExistingJobIds(ids: string[]): Promise<string[]> {
  const { rows } = await query<{ id: string }>("SELECT id FROM core.backup_jobs WHERE id = ANY($1::uuid[])", [ids]);
  return rows.map((r) => r.id);
}

export interface GroupFields {
  name: string;
  description: string | null;
  isActive: boolean;
}

/** Inserta o actualiza el grupo y reemplaza sus miembros (en orden), en una transacción. */
export async function saveGroup(id: string | null, f: Partial<GroupFields>, jobIds?: string[]): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let groupId = id;
    if (!groupId) {
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO core.job_groups (name, description, is_active) VALUES ($1,$2,$3) RETURNING id",
        [f.name, f.description ?? null, f.isActive ?? true],
      );
      groupId = rows[0]!.id;
    } else {
      await client.query(
        `UPDATE core.job_groups SET name = COALESCE($2, name),
           description = CASE WHEN $3::boolean THEN $4 ELSE description END,
           is_active = COALESCE($5, is_active)
         WHERE id = $1`,
        [groupId, f.name ?? null, f.description !== undefined, f.description ?? null, f.isActive ?? null],
      );
    }
    if (jobIds) {
      await client.query("DELETE FROM core.job_group_members WHERE group_id = $1", [groupId]);
      await client.query(
        `INSERT INTO core.job_group_members (group_id, job_id, position)
         SELECT $1, j, p::int FROM unnest($2::uuid[]) WITH ORDINALITY AS t(j, p)`,
        [groupId, jobIds],
      );
    }
    await client.query("COMMIT");
    return groupId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteGroup(id: string): Promise<void> {
  await query("DELETE FROM core.job_groups WHERE id = $1", [id]);
}

/** Evento del grupo listo para lanzarse. */
export interface RunnableMember {
  jobId: string;
  name: string;
  method: BackupMethod;
  environment: string | null;
  isActive: boolean;
  databases: string[];
}

/** Eventos del grupo para dispararlo: exports de Cloud SQL primero, luego por posición. */
export async function findMembersForRun(groupId: string): Promise<RunnableMember[]> {
  const { rows } = await query<{
    job_id: string;
    name: string;
    method: BackupMethod;
    environment: string | null;
    is_active: boolean;
    databases: string[];
  }>(
    `SELECT j.id AS job_id, j.name, j.method, j.environment, j.is_active,
            COALESCE((SELECT array_agg(d.db_name ORDER BY d.db_name)
                      FROM core.backup_job_databases d WHERE d.job_id = j.id), '{}') AS databases
     FROM core.job_group_members m
     JOIN core.backup_jobs j ON j.id = m.job_id
     WHERE m.group_id = $1
     ORDER BY (j.method = 'cloudsql_export') DESC, m.position`,
    [groupId],
  );
  return rows.map((r) => ({
    jobId: r.job_id,
    name: r.name,
    method: r.method,
    environment: r.environment,
    isActive: r.is_active,
    databases: r.databases,
  }));
}

/** Crea las ejecuciones del grupo en una transacción (todas o ninguna), en orden de cola. */
export async function createGroupExecutions(
  group: { id: string; name: string },
  members: RunnableMember[],
  origin: "manual" | "scheduled",
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids: string[] = [];
    for (const m of members) {
      ids.push(
        await insertExecution(client, {
          jobId: m.jobId,
          label: m.name,
          environment: m.environment,
          databases: m.databases,
          origin,
          group,
        }),
      );
    }
    await client.query("COMMIT");
    return ids;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
