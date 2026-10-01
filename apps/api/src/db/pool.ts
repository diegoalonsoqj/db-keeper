import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const { Pool } = pg;

/**
 * Pool único de conexiones a la BD de metadatos (PostgreSQL 16).
 * Toda capa de datos (repositories) usa este pool. Las queries van
 * SIEMPRE parametrizadas.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "Error inesperado en cliente del pool de PostgreSQL");
});

/** Helper tipado para queries parametrizadas. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
