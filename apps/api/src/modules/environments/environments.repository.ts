import type { EnvironmentDto } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

interface EnvironmentRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: EnvironmentRow): EnvironmentDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listEnvironments(p: {
  limit: number;
  offset: number;
}): Promise<{ items: EnvironmentDto[]; total: number }> {
  const totalRes = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM core.environments",
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const { rows } = await query<EnvironmentRow>(
    "SELECT * FROM core.environments ORDER BY name LIMIT $1 OFFSET $2",
    [p.limit, p.offset],
  );
  return { items: rows.map(toDto), total };
}

export async function findById(id: string): Promise<EnvironmentDto | null> {
  const { rows } = await query<EnvironmentRow>("SELECT * FROM core.environments WHERE id = $1", [id]);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function findByName(name: string): Promise<{ id: string } | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM core.environments WHERE lower(name) = lower($1)",
    [name],
  );
  return rows[0] ?? null;
}

export async function findByCode(code: string): Promise<{ id: string } | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM core.environments WHERE lower(code) = lower($1)",
    [code],
  );
  return rows[0] ?? null;
}

export interface EnvironmentFields {
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
}

export async function insertEnvironment(fields: EnvironmentFields): Promise<string> {
  const { rows } = await query<{ id: string }>(
    "INSERT INTO core.environments (name, code, description, is_active) VALUES ($1,$2,$3,$4) RETURNING id",
    [fields.name, fields.code, fields.description, fields.isActive],
  );
  return rows[0]!.id;
}

export async function updateEnvironment(id: string, fields: Partial<EnvironmentFields>): Promise<void> {
  const map: Record<string, string> = {
    name: "name",
    code: "code",
    description: "description",
    isActive: "is_active",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(map)) {
    const v = (fields as Record<string, unknown>)[k];
    if (v !== undefined) (sets.push(`${col} = $${i++}`), params.push(v));
  }
  if (sets.length === 0) return;
  params.push(id);
  await query(`UPDATE core.environments SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function deleteEnvironment(id: string): Promise<void> {
  await query("DELETE FROM core.environments WHERE id = $1", [id]);
}

/** Cuántas instancias usan este ambiente por nombre (para avisar antes de borrar). */
export async function countServersUsing(name: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM core.servers WHERE lower(environment) = lower($1)",
    [name],
  );
  return Number(rows[0]?.count ?? 0);
}
