import pg from "pg";
import type { DiscoveredDatabase, PgEventTrigger, PgExtension } from "@dbkeeper/shared";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

/**
 * BDs internas de servicios gestionados (Cloud SQL, RDS, Azure): el usuario no
 * puede leerlas y su dump fallaría siempre. La BD `postgres` sí se ofrece.
 */
const PROVIDER_INTERNAL = new Set(["cloudsqladmin", "rdsadmin", "azure_maintenance", "azure_sys"]);

/** Abre una conexión a `dbName`, ejecuta `fn` y la cierra siempre. */
async function withDbClient<T>(conn: ConnInfo, dbName: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: dbName,
    ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: DISCOVER_TIMEOUT_MS,
    statement_timeout: DISCOVER_TIMEOUT_MS,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Esquemas de usuario de una BD (sin los de sistema: pg_catalog, information_schema,
 * pg_toast y temporales). Para elegir cuáles excluir del dump.
 */
export function listPostgresSchemas(conn: ConnInfo, dbName: string): Promise<string[]> {
  return withDbClient(conn, dbName, async (client) => {
    const { rows } = await client.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
       ORDER BY nspname`,
    );
    return rows.map((r) => r.nspname);
  });
}

/**
 * Extensiones instaladas en una BD, para elegir cuáles excluir del dump. plpgsql
 * no se ofrece: pg_dump nunca la vuelca.
 */
export function listPostgresExtensions(conn: ConnInfo, dbName: string): Promise<PgExtension[]> {
  return withDbClient(conn, dbName, async (client) => {
    const { rows } = await client.query<{ extname: string; extversion: string }>(
      `SELECT extname, extversion FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`,
    );
    return rows.map((r) => ({ name: r.extname, version: r.extversion }));
  });
}

/** Event triggers de una BD, para elegir cuáles excluir del dump. */
export function listPostgresEventTriggers(conn: ConnInfo, dbName: string): Promise<PgEventTrigger[]> {
  return withDbClient(conn, dbName, async (client) => {
    const { rows } = await client.query<{ evtname: string; evtevent: string; evtenabled: string }>(
      `SELECT evtname, evtevent, evtenabled FROM pg_event_trigger ORDER BY evtname`,
    );
    return rows.map((r) => ({ name: r.evtname, event: r.evtevent, enabled: r.evtenabled }));
  });
}

export async function discoverPostgres(conn: ConnInfo): Promise<DiscoveredDatabase[]> {
  const client = new pg.Client({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: "postgres", // BD de mantenimiento para listar el resto
    ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: DISCOVER_TIMEOUT_MS,
    statement_timeout: DISCOVER_TIMEOUT_MS,
  });
  await client.connect();
  try {
    // pg_database_size exige CONNECT sobre la BD: sin ese permiso el tamaño queda null.
    const { rows } = await client.query<{ datname: string; bytes: string | null }>(
      `SELECT datname,
              CASE WHEN has_database_privilege(datname, 'CONNECT') THEN pg_database_size(datname) END AS bytes
       FROM pg_database WHERE datistemplate = false AND datallowconn ORDER BY datname`,
    );
    return rows
      .filter((r) => !PROVIDER_INTERNAL.has(r.datname))
      .map((r) => ({ name: r.datname, bytes: r.bytes === null ? null : Number(r.bytes) }));
  } finally {
    await client.end();
  }
}
