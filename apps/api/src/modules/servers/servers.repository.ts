import type { DbEngine, ServerDto, ServerPlatform, ServerSort, SortDir } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";
import { orderBy, SqlWhere } from "../../lib/list-query.js";

interface ServerRow {
  id: string;
  name: string;
  engine: DbEngine;
  host: string | null;
  port: number;
  environment: string | null;
  use_ssl: boolean;
  mongo_srv: boolean;
  conn_options: Record<string, string>;
  is_cloud_sql: boolean;
  is_alloydb: boolean;
  gcp_project: string | null;
  gcp_instance: string | null;
  cloud_credential_id: string | null;
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
    mongoSrv: row.mongo_srv,
    connOptions: row.conn_options ?? {},
    isCloudSql: row.is_cloud_sql,
    isAlloyDb: row.is_alloydb,
    gcpProject: row.gcp_project,
    gcpInstance: row.gcp_instance,
    cloudCredentialId: row.cloud_credential_id,
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

export interface ServerListQuery {
  limit: number;
  offset: number;
  /** Nombre, host o instancia de Cloud SQL. */
  q?: string;
  engine?: DbEngine;
  platform?: ServerPlatform;
  environment?: string;
  sort?: ServerSort;
  dir?: SortDir;
}

const SERVER_ORDER: Record<ServerSort, string> = {
  name: "lower(s.name)",
  engine: "s.engine",
  host: "lower(COALESCE(s.host, s.gcp_instance))",
  port: "s.port",
  environment: "s.environment",
  credential: "lower(c.name)",
};

const PLATFORM_WHERE: Record<ServerPlatform, string> = {
  standard: "NOT s.is_cloud_sql AND NOT s.is_alloydb",
  cloudsql: "s.is_cloud_sql",
  alloydb: "s.is_alloydb",
};

export async function listServers(p: ServerListQuery): Promise<{ items: ServerDto[]; total: number }> {
  const w = new SqlWhere()
    .eq("s.engine", p.engine)
    .eq("s.environment", p.environment)
    .search(["s.name", "s.host", "s.gcp_instance"], p.q);
  if (p.platform) w.add(PLATFORM_WHERE[p.platform]);
  const totalRes = await query<{ count: string }>(`SELECT count(*)::text AS count FROM core.servers s ${w.sql}`, w.params);
  const total = Number(totalRes.rows[0]?.count ?? 0);
  const order = orderBy(SERVER_ORDER, p.sort, p.dir, { sort: "name", dir: "asc" }, "s.id");
  const n = w.params.length;
  const { rows } = await query<ServerRow>(
    `${SELECT_SERVER} ${w.sql} ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...w.params, p.limit, p.offset],
  );
  return { items: rows.map(toServer), total };
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
  host: string | null;
  port: number;
  environment: string | null;
  useSsl: boolean;
  mongoSrv: boolean;
  connOptions: Record<string, string>;
  isCloudSql: boolean;
  isAlloyDb: boolean;
  gcpProject: string | null;
  gcpInstance: string | null;
  cloudCredentialId: string | null;
  notes: string | null;
  credentialId: string | null;
}

export async function insertServer(fields: ServerFields): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO core.servers
       (name, engine, host, port, environment, use_ssl, is_cloud_sql, gcp_project, gcp_instance, notes, credential_id, cloud_credential_id, mongo_srv, conn_options, is_alloydb)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
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
      fields.cloudCredentialId,
      fields.mongoSrv,
      JSON.stringify(fields.connOptions),
      fields.isAlloyDb,
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
    mongoSrv: "mongo_srv",
    connOptions: "conn_options",
    isCloudSql: "is_cloud_sql",
    isAlloyDb: "is_alloydb",
    gcpProject: "gcp_project",
    gcpInstance: "gcp_instance",
    cloudCredentialId: "cloud_credential_id",
    notes: "notes",
    credentialId: "credential_id",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(map)) {
    let v = (fields as Record<string, unknown>)[k];
    if (k === "connOptions" && v !== undefined) v = JSON.stringify(v); // jsonb
    if (v !== undefined) (sets.push(`${col} = $${i++}`), params.push(v));
  }
  if (sets.length === 0) return;
  params.push(id);
  await query(`UPDATE core.servers SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function deleteServer(id: string): Promise<void> {
  await query("DELETE FROM core.servers WHERE id = $1", [id]);
}

/** Eventos (activos o no) de la instancia que usan el export de Cloud SQL. */
export async function countCloudSqlExportJobs(serverId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM core.backup_jobs WHERE server_id = $1 AND method = 'cloudsql_export'",
    [serverId],
  );
  return Number(rows[0]?.count ?? 0);
}
