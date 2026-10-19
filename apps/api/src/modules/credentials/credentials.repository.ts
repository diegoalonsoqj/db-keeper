import type { CredentialDto, CredentialSort, SortDir } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";
import { orderBy, SqlWhere } from "../../lib/list-query.js";

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

export interface CredentialListQuery {
  limit: number;
  offset: number;
  /** Nombre o usuario. */
  q?: string;
  environment?: string;
  sort?: CredentialSort;
  dir?: SortDir;
}

const CREDENTIAL_ORDER: Record<CredentialSort, string> = {
  name: "lower(name)",
  username: "lower(username)",
  environment: "environment",
  description: "lower(description)",
};

export async function listCredentials(p: CredentialListQuery): Promise<{ items: CredentialDto[]; total: number }> {
  const w = new SqlWhere().eq("environment", p.environment).search(["name", "username"], p.q);
  const totalRes = await query<{ count: string }>(`SELECT count(*)::text AS count FROM secrets.credentials ${w.sql}`, w.params);
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const order = orderBy(CREDENTIAL_ORDER, p.sort, p.dir, { sort: "name", dir: "asc" }, "id");
  const n = w.params.length;
  const { rows } = await query<CredentialRow>(
    `SELECT * FROM secrets.credentials ${w.sql} ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...w.params, p.limit, p.offset],
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
  /** Usuario que escribió la contraseña (ver credential-guard). */
  passwordSetBy: string | null;
}

export async function insertCredential(fields: CredentialFields): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO secrets.credentials (name, username, password_encrypted, extra_encrypted, environment, description, password_set_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      fields.name,
      fields.username,
      fields.passwordEncrypted,
      fields.extraEncrypted,
      fields.environment,
      fields.description,
      fields.passwordSetBy,
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
    passwordSetBy: "password_set_by",
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
/** Quién escribió la contraseña (null = credencial anterior a registrarlo). */
export async function getPasswordSetBy(id: string): Promise<string | null> {
  const { rows } = await query<{ password_set_by: string | null }>(
    "SELECT password_set_by FROM secrets.credentials WHERE id = $1",
    [id],
  );
  return rows[0]?.password_set_by ?? null;
}

/** ¿La instancia ya usa la credencial (como propia o en alguno de sus eventos)? */
export async function isLinkedToServer(credentialId: string, serverId: string): Promise<boolean> {
  const { rows } = await query<{ linked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM core.servers WHERE id = $2 AND credential_id = $1)
         OR EXISTS (SELECT 1 FROM core.backup_jobs WHERE server_id = $2 AND credential_id = $1) AS linked`,
    [credentialId, serverId],
  );
  return rows[0]?.linked ?? false;
}

/** Credenciales alternativas de los eventos de la instancia. */
export async function jobCredentialsOfServer(serverId: string): Promise<string[]> {
  const { rows } = await query<{ credential_id: string }>(
    "SELECT DISTINCT credential_id FROM core.backup_jobs WHERE server_id = $1 AND credential_id IS NOT NULL",
    [serverId],
  );
  return rows.map((r) => r.credential_id);
}

export async function countServersUsing(id: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM core.servers WHERE credential_id = $1",
    [id],
  );
  return Number(rows[0]?.count ?? 0);
}
