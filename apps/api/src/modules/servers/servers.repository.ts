import type { DbEngine, ServerDto } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

interface ServerRow {
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  environment: string | null;
  use_ssl: boolean;
  is_cloud_sql: boolean;
  gcp_project: string | null;
  gcp_instance: string | null;
  notes: string | null;
  credential_id: string | null;
  created_at: Date;
  updated_at: Date;
  cred_name: string | null;
  cred_username: string | null;
}

function toServer(row: ServerRow): ServerDto {
  return {
    id: row.id,
    name: row.name,
    engine: row.engine,
    host: row.host,
    port: row.port,
    environment: row.environment,
    useSsl: row.use_ssl,
    isCloudSql: row.is_cloud_sql,
    gcpProject: row.gcp_project,
    gcpInstance: row.gcp_instance,
    notes: row.notes,
    credentialId: row.credential_id,
    credentialName: row.cred_name,
    credentialUsername: row.cred_username,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_SERVER = `
  SELECT s.*, c.name AS cred_name, c.username AS cred_username
  FROM core.servers s
  LEFT JOIN secrets.credentials c ON c.id = s.credential_id
`;

export async function listServers(): Promise<ServerDto[]> {
  const { rows } = await query<ServerRow>(`${SELECT_SERVER} ORDER BY s.name`);
  return rows.map(toServer);
}

export async function findById(id: string): Promise<ServerDto | null> {
  const { rows } = await query<ServerRow>(`${SELECT_SERVER} WHERE s.id = $1`, [id]);
  return rows[0] ? toServer(rows[0]) : null;
}

export async function findByName(name: string): Promise<{ id: string } | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM core.servers WHERE lower(name) = lower($1)",
    [name],
  );
  return rows[0] ?? null;
}

export interface ServerFields {
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  environment: string | null;
  useSsl: boolean;
  isCloudSql: boolean;
  gcpProject: string | null;
  gcpInstance: string | null;
  notes: string | null;
  credentialId: string | null;
}

export async function insertServer(fields: ServerFields): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO core.servers
       (name, engine, host, port, environment, use_ssl, is_cloud_sql, gcp_project, gcp_instance, notes, credential_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      fields.name,
      fields.engine,
      fields.host,
      fields.port,
      fields.environment,
      fields.useSsl,
      fields.isCloudSql,
      fields.gcpProject,
      fields.gcpInstance,
      fields.notes,
      fields.credentialId,
    ],
  );
  return rows[0]!.id;
}

export async function updateServerFields(id: string, fields: Partial<ServerFields>): Promise<void> {
  const map: Record<string, string> = {
    name: "name",
    engine: "engine",
    host: "host",
    port: "port",
    environment: "environment",
    useSsl: "use_ssl",
    isCloudSql: "is_cloud_sql",
    gcpProject: "gcp_project",
    gcpInstance: "gcp_instance",
    notes: "notes",
    credentialId: "credential_id",
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
  await query(`UPDATE core.servers SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function deleteServer(id: string): Promise<void> {
  await query("DELETE FROM core.servers WHERE id = $1", [id]);
}
