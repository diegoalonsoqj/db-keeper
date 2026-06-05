import pg from "pg";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

/** Bases que nunca se ofrecen para respaldo. */
const SYSTEM = new Set(["postgres"]);

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
