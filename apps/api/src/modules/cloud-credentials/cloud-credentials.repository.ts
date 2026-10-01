import type { CloudCredentialDto, CloudCredentialKind, CloudProvider } from "@dbkeeper/shared";
import { pool, query } from "../../db/pool.js";

interface Row {
  id: string;
  name: string;
  provider: CloudProvider;
  kind: CloudCredentialKind;
  metadata: Record<string, unknown>;
  is_active: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: Row): CloudCredentialDto {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    kind: row.kind,
    metadata: row.metadata ?? {},
    isActive: row.is_active,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLS = "id, name, provider, kind, metadata, is_active, is_default, created_at, updated_at";

export async function list(p: {
  limit: number;
  offset: number;
}): Promise<{ items: CloudCredentialDto[]; total: number }> {
  const totalRes = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM secrets.cloud_credentials",
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const { rows } = await query<Row>(
    `SELECT ${COLS} FROM secrets.cloud_credentials ORDER BY name LIMIT $1 OFFSET $2`,
    [p.limit, p.offset],
  );
  return { items: rows.map(toDto), total };
}

export async function findById(id: string): Promise<CloudCredentialDto | null> {
  const { rows } = await query<Row>(`SELECT ${COLS} FROM secrets.cloud_credentials WHERE id = $1`, [id]);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function findByName(name: string): Promise<{ id: string } | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM secrets.cloud_credentials WHERE lower(name) = lower($1)",
    [name],
  );
  return rows[0] ?? null;
}

/** Id de la credencial activa marcada por defecto para el proveedor (o null). */
export async function findDefaultActiveId(provider: CloudProvider): Promise<string | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM secrets.cloud_credentials WHERE provider = $1 AND is_default AND is_active",
    [provider],
  );
  return rows[0]?.id ?? null;
}

/** Secreto cifrado (clave de la nube) para autenticarse; null en las de tipo `compute`. */
export async function getSecretEncrypted(id: string): Promise<string | null> {
  const { rows } = await query<{ secret_encrypted: string | null }>(
    "SELECT secret_encrypted FROM secrets.cloud_credentials WHERE id = $1",
    [id],
  );
  return rows[0]?.secret_encrypted ?? null;
}

/** Id de la entrada que representa la identidad de la VM para el proveedor (o null). */
export async function findComputeId(provider: CloudProvider): Promise<string | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM secrets.cloud_credentials WHERE provider = $1 AND kind = 'compute'",
    [provider],
  );
  return rows[0]?.id ?? null;
}

export interface Fields {
  name: string;
  provider: CloudProvider;
  metadata: Record<string, unknown>;
  /** null solo en las de tipo `compute` (sin clave). */
  secretEncrypted: string | null;
  isActive: boolean;
  kind?: CloudCredentialKind;
}

export async function insert(fields: Fields): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO secrets.cloud_credentials (name, provider, kind, metadata, secret_encrypted, is_active)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [fields.name, fields.provider, fields.kind ?? "key", fields.metadata, fields.secretEncrypted, fields.isActive],
  );
  return rows[0]!.id;
}

export async function update(id: string, fields: Partial<Fields>): Promise<void> {
  const map: Record<string, string> = {
    name: "name",
    provider: "provider",
    metadata: "metadata",
    secretEncrypted: "secret_encrypted",
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
  await query(`UPDATE secrets.cloud_credentials SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function remove(id: string): Promise<void> {
  await query("DELETE FROM secrets.cloud_credentials WHERE id = $1", [id]);
}

/** Marca la credencial como por defecto de su proveedor (desmarca las demás del mismo). */
export async function setDefault(id: string, provider: CloudProvider): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE secrets.cloud_credentials SET is_default = false WHERE provider = $1", [provider]);
    await client.query("UPDATE secrets.cloud_credentials SET is_default = true WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Cuántos destinos e instancias (API de Cloud SQL) usan esta credencial (para avisar antes de borrar). */
export async function countTargetsUsing(id: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT ((SELECT count(*) FROM core.storage_targets WHERE cloud_credential_id = $1)
           + (SELECT count(*) FROM core.servers WHERE cloud_credential_id = $1))::text AS count`,
    [id],
  );
  return Number(rows[0]?.count ?? 0);
}
