import type { CloudProvider, StorageTargetDto, StorageType } from "@dbkeeper/shared";
import { pool, query } from "../../db/pool.js";

interface TargetRow {
  id: string;
  type: StorageType;
  name: string;
  path: string | null;
  provider: CloudProvider | null;
  bucket: string | null;
  prefix: string | null;
  cloud_credential_id: string | null;
  cloud_cred_name: string | null;
  is_active: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: TargetRow): StorageTargetDto {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    path: row.path,
    provider: row.provider,
    bucket: row.bucket,
    prefix: row.prefix,
    isActive: row.is_active,
    isDefault: row.is_default,
    cloudCredentialId: row.cloud_credential_id,
    cloudCredentialName: row.cloud_cred_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT = `
  SELECT t.*, cc.name AS cloud_cred_name
  FROM core.storage_targets t
  LEFT JOIN secrets.cloud_credentials cc ON cc.id = t.cloud_credential_id
`;

export async function listTargets(p: {
  limit: number;
  offset: number;
}): Promise<{ items: StorageTargetDto[]; total: number }> {
  const totalRes = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM core.storage_targets",
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const { rows } = await query<TargetRow>(
    `${SELECT} ORDER BY t.type, t.name LIMIT $1 OFFSET $2`,
    [p.limit, p.offset],
  );
  return { items: rows.map(toDto), total };
}

export async function findById(id: string): Promise<StorageTargetDto | null> {
  const { rows } = await query<TargetRow>(`${SELECT} WHERE t.id = $1`, [id]);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function findByName(name: string): Promise<{ id: string } | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM core.storage_targets WHERE lower(name) = lower($1)",
    [name],
  );
  return rows[0] ?? null;
}

export interface TargetFields {
  type: StorageType;
  name: string;
  path: string | null;
  provider: CloudProvider | null;
  bucket: string | null;
  prefix: string | null;
  cloudCredentialId: string | null;
  isActive: boolean;
}

export async function insertTarget(fields: TargetFields): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO core.storage_targets
       (type, name, path, provider, bucket, prefix, cloud_credential_id, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      fields.type,
      fields.name,
      fields.path,
      fields.provider,
      fields.bucket,
      fields.prefix,
      fields.cloudCredentialId,
      fields.isActive,
    ],
  );
  return rows[0]!.id;
}

export async function updateTarget(id: string, fields: Partial<TargetFields>): Promise<void> {
  const map: Record<string, string> = {
    type: "type",
    name: "name",
    path: "path",
    provider: "provider",
    bucket: "bucket",
    prefix: "prefix",
    cloudCredentialId: "cloud_credential_id",
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
  await query(`UPDATE core.storage_targets SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function deleteTarget(id: string): Promise<void> {
  await query("DELETE FROM core.storage_targets WHERE id = $1", [id]);
}

/** Marca un destino como por defecto de su tipo (y desmarca el anterior). */
export async function setDefault(id: string, type: StorageType): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE core.storage_targets SET is_default = false WHERE type = $1", [type]);
    await client.query("UPDATE core.storage_targets SET is_default = true WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Devuelve el destino por defecto de un tipo (o null). */
export async function findDefault(type: StorageType): Promise<StorageTargetDto | null> {
  const { rows } = await query<TargetRow>(`${SELECT} WHERE t.type = $1 AND t.is_default = true`, [type]);
  return rows[0] ? toDto(rows[0]) : null;
}

/** Destino tipo bucket activo cuyo bucket coincide (para resolver credenciales en descarga). */
export async function findBucketByName(bucket: string): Promise<StorageTargetDto | null> {
  const { rows } = await query<TargetRow>(
    `${SELECT} WHERE t.type = 'bucket' AND t.bucket = $1 AND t.is_active = true ORDER BY t.is_default DESC LIMIT 1`,
    [bucket],
  );
  return rows[0] ? toDto(rows[0]) : null;
}
