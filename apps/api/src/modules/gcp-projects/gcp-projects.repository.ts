import type { GcpProjectDto } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

interface GcpProjectRow {
  id: string;
  project_id: string;
  name: string | null;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: GcpProjectRow): GcpProjectDto {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listGcpProjects(p: { limit: number; offset: number }): Promise<{ items: GcpProjectDto[]; total: number }> {
  const totalRes = await query<{ count: string }>("SELECT count(*)::text AS count FROM core.gcp_projects");
  const { rows } = await query<GcpProjectRow>(
    "SELECT * FROM core.gcp_projects ORDER BY lower(project_id) LIMIT $1 OFFSET $2",
    [p.limit, p.offset],
  );
  return { items: rows.map(toDto), total: Number(totalRes.rows[0]?.count ?? 0) };
}

export async function findById(id: string): Promise<GcpProjectDto | null> {
  const { rows } = await query<GcpProjectRow>("SELECT * FROM core.gcp_projects WHERE id = $1", [id]);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function findByProjectId(projectId: string): Promise<{ id: string } | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM core.gcp_projects WHERE lower(project_id) = lower($1)",
    [projectId],
  );
  return rows[0] ?? null;
}

export interface GcpProjectFields {
  projectId: string;
  name: string | null;
  description: string | null;
  isActive: boolean;
}

export async function insertGcpProject(f: GcpProjectFields): Promise<string> {
  const { rows } = await query<{ id: string }>(
    "INSERT INTO core.gcp_projects (project_id, name, description, is_active) VALUES ($1,$2,$3,$4) RETURNING id",
    [f.projectId, f.name, f.description, f.isActive],
  );
  return rows[0]!.id;
}

export async function updateGcpProject(id: string, fields: Partial<GcpProjectFields>): Promise<void> {
  const map: Record<string, string> = { projectId: "project_id", name: "name", description: "description", isActive: "is_active" };
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(map)) {
    const v = (fields as Record<string, unknown>)[k];
    if (v !== undefined) (sets.push(`${col} = $${i++}`), params.push(v));
  }
  if (sets.length === 0) return;
  params.push(id);
  await query(`UPDATE core.gcp_projects SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function deleteGcpProject(id: string): Promise<void> {
  await query("DELETE FROM core.gcp_projects WHERE id = $1", [id]);
}

/** Cuántas instancias usan el proyecto (para avisar antes de borrar o renombrar). */
export async function countServersUsing(projectId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM core.servers WHERE lower(btrim(gcp_project)) = lower($1)",
    [projectId],
  );
  return Number(rows[0]?.count ?? 0);
}
