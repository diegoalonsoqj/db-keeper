import type { GcpServiceAccountDto } from "@dbkeeper/shared";
import { pool, query } from "../../db/pool.js";

interface Row {
  id: string;
  name: string;
  client_email: string | null;
  project_id: string | null;
  is_active: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: Row): GcpServiceAccountDto {
  return {
    id: row.id,
    name: row.name,
    clientEmail: row.client_email,
    projectId: row.project_id,
    isActive: row.is_active,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLS =
  "id, name, client_email, project_id, is_active, is_default, created_at, updated_at";

export async function list(p: {
  limit: number;
  offset: number;
}): Promise<{ items: GcpServiceAccountDto[]; total: number }> {
  const totalRes = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM secrets.gcp_service_accounts",
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const { rows } = await query<Row>(
    `SELECT ${COLS} FROM secrets.gcp_service_accounts ORDER BY name LIMIT $1 OFFSET $2`,
    [p.limit, p.offset],
  );
  return { items: rows.map(toDto), total };
}

export async function findById(id: string): Promise<GcpServiceAccountDto | null> {
  const { rows } = await query<Row>(`SELECT ${COLS} FROM secrets.gcp_service_accounts WHERE id = $1`, [id]);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function findByName(name: string): Promise<{ id: string } | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM secrets.gcp_service_accounts WHERE lower(name) = lower($1)",
    [name],
  );
  return rows[0] ?? null;
}

/** Clave JSON cifrada (para autenticarse contra GCP). */
export async function getKeyEncrypted(id: string): Promise<string | null> {
  const { rows } = await query<{ key_encrypted: string }>(
    "SELECT key_encrypted FROM secrets.gcp_service_accounts WHERE id = $1",
    [id],
  );
  return rows[0]?.key_encrypted ?? null;
}

export interface Fields {
  name: string;
  clientEmail: string | null;
  projectId: string | null;
  keyEncrypted: string;
  isActive: boolean;
}

export async function insert(fields: Fields): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO secrets.gcp_service_accounts (name, client_email, project_id, key_encrypted, is_active)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [fields.name, fields.clientEmail, fields.projectId, fields.keyEncrypted, fields.isActive],
  );
  return rows[0]!.id;
}

export async function update(id: string, fields: Partial<Fields>): Promise<void> {
  const map: Record<string, string> = {
    name: "name",
    clientEmail: "client_email",
    projectId: "project_id",
    keyEncrypted: "key_encrypted",
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
  await query(`UPDATE secrets.gcp_service_accounts SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function remove(id: string): Promise<void> {
  await query("DELETE FROM secrets.gcp_service_accounts WHERE id = $1", [id]);
}

export async function setDefault(id: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE secrets.gcp_service_accounts SET is_default = false WHERE is_default = true");
    await client.query("UPDATE secrets.gcp_service_accounts SET is_default = true WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Cuántos destinos GCS usan esta cuenta (para avisar antes de borrar). */
export async function countTargetsUsing(id: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM core.storage_targets WHERE gcp_service_account_id = $1",
    [id],
  );
  return Number(rows[0]?.count ?? 0);
}
