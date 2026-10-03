import pg from "pg";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

/** Bases que nunca se ofrecen para respaldo. */
const SYSTEM = new Set(["postgres"]);

/**
 * Esquemas de usuario de una BD (sin los de sistema: pg_catalog, information_schema,
 * pg_toast y temporales). Para elegir cuáles excluir del dump.
 */
export async function listPostgresSchemas(conn: ConnInfo, dbName: string): Promise<string[]> {
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
    const { rows } = await client.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
       ORDER BY nspname`,
    );
    return rows.map((r) => r.nspname);
  } finally {
    await client.end();
  }
}

export async function discoverPostgres(conn: ConnInfo): Promise<string[]> {
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
    const { rows } = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
    );
    return rows.map((r) => r.datname).filter((n) => !SYSTEM.has(n));
  } finally {
    await client.end();
  }
}
