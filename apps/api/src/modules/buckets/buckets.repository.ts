import type { BucketDto, StorageProvider } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

interface BucketRow {
  id: string;
  name: string;
  provider: StorageProvider;
  bucket: string;
  prefix: string | null;
  service_account_encrypted: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toBucket(row: BucketRow): BucketDto {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    bucket: row.bucket,
    prefix: row.prefix,
    isActive: row.is_active,
    hasServiceAccount: row.service_account_encrypted !== null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listBuckets(): Promise<BucketDto[]> {
  const { rows } = await query<BucketRow>("SELECT * FROM core.storage_buckets ORDER BY name");
  return rows.map(toBucket);
}

export async function findById(id: string): Promise<BucketDto | null> {
  const { rows } = await query<BucketRow>("SELECT * FROM core.storage_buckets WHERE id = $1", [id]);
  return rows[0] ? toBucket(rows[0]) : null;
}

export async function findByName(name: string): Promise<{ id: string } | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM core.storage_buckets WHERE lower(name) = lower($1)",
    [name],
  );
  return rows[0] ?? null;
}

export interface BucketFields {
  name: string;
  provider: StorageProvider;
  bucket: string;
  prefix: string | null;
  isActive: boolean;
}

export async function insertBucket(
  fields: BucketFields,
  serviceAccountEncrypted: string | null,
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO core.storage_buckets (name, provider, bucket, prefix, is_active, service_account_encrypted)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [fields.name, fields.provider, fields.bucket, fields.prefix, fields.isActive, serviceAccountEncrypted],
  );
  return rows[0]!.id;
}

export async function updateBucket(
  id: string,
  fields: Partial<BucketFields>,
  serviceAccountEncrypted?: string | null,
): Promise<void> {
  const map: Record<string, string> = {
    name: "name",
    provider: "provider",
    bucket: "bucket",
    prefix: "prefix",
    isActive: "is_active",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(map)) {
    const v = (fields as Record<string, unknown>)[k];
    if (v !== undefined) (sets.push(`${col} = $${i++}`), params.push(v));
  }
  if (serviceAccountEncrypted !== undefined) {
    sets.push(`service_account_encrypted = $${i++}`);
    params.push(serviceAccountEncrypted);
  }
  if (sets.length === 0) return;
  params.push(id);
  await query(`UPDATE core.storage_buckets SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function deleteBucket(id: string): Promise<void> {
  await query("DELETE FROM core.storage_buckets WHERE id = $1", [id]);
}
