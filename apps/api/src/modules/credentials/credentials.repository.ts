import type { CredentialDto } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

interface CredentialRow {
  id: string;
  name: string;
  username: string;
  password_encrypted: string;
  extra_encrypted: string | null;
  environment: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: CredentialRow): CredentialDto {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    environment: row.environment,
    description: row.description,
    hasExtra: row.extra_encrypted !== null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listCredentials(p: {
  limit: number;
  offset: number;
}): Promise<{ items: CredentialDto[]; total: number }> {
  const totalRes = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM secrets.credentials",
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const { rows } = await query<CredentialRow>(
    "SELECT * FROM secrets.credentials ORDER BY name LIMIT $1 OFFSET $2",
    [p.limit, p.offset],
  );
  return { items: rows.map(toDto), total };
}

export async function findById(id: string): Promise<CredentialDto | null> {
  const { rows } = await query<CredentialRow>("SELECT * FROM secrets.credentials WHERE id = $1", [id]);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function findByName(name: string): Promise<{ id: string } | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM secrets.credentials WHERE lower(name) = lower($1)",
    [name],
  );
  return rows[0] ?? null;
}

/** Devuelve los secretos cifrados (para conservarlos en ediciones parciales). */
export async function getEncrypted(
  id: string,
): Promise<{ passwordEncrypted: string; extraEncrypted: string | null } | null> {
  const { rows } = await query<{ password_encrypted: string; extra_encrypted: string | null }>(
    "SELECT password_encrypted, extra_encrypted FROM secrets.credentials WHERE id = $1",
    [id],
  );
  return rows[0]
    ? { passwordEncrypted: rows[0].password_encrypted, extraEncrypted: rows[0].extra_encrypted }
    : null;
}

export interface CredentialFields {
  name: string;
  username: string;
  passwordEncrypted: string;
  extraEncrypted: string | null;
  environment: string | null;
  description: string | null;
}

export async function insertCredential(fields: CredentialFields): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO secrets.credentials (name, username, password_encrypted, extra_encrypted, environment, description)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      fields.name,
      fields.username,
      fields.passwordEncrypted,
      fields.extraEncrypted,
      fields.environment,
      fields.description,
    ],
  );
  return rows[0]!.id;
}

export async function updateCredential(id: string, fields: Partial<CredentialFields>): Promise<void> {
  const map: Record<string, string> = {
    name: "name",
    username: "username",
    passwordEncrypted: "password_encrypted",
    extraEncrypted: "extra_encrypted",
    environment: "environment",
    description: "description",
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
  await query(`UPDATE secrets.credentials SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function deleteCredential(id: string): Promise<void> {
  await query("DELETE FROM secrets.credentials WHERE id = $1", [id]);
}

/** Cuántas instancias usan esta credencial (para avisar antes de borrar). */
export async function countServersUsing(id: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM core.servers WHERE credential_id = $1",
    [id],
  );
  return Number(rows[0]?.count ?? 0);
}
