import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import { logger } from "../config/logger.js";

/**
 * Runner de migraciones minimalista basado en archivos `.sql` versionados.
 * Mantiene control total sobre el SQL (ver CLAUDE.md §1). Cada archivo se
 * aplica una sola vez, en orden alfabético, dentro de una transacción, y
 * queda registrado en `public._migrations`.
 *
 * Convención de nombre: `NNNN_descripcion.sql` (ej. `0001_init_schemas.sql`).
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public._migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM public._migrations");
  return new Set(rows.map((r) => r.name));
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    logger.info("No hay migraciones pendientes.");
    return;
  }

  for (const file of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO public._migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      logger.info({ migration: file }, "Migración aplicada");
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ err, migration: file }, "Falló la migración; se revirtió la transacción");
      throw err;
    } finally {
      client.release();
    }
  }
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async () => {
    await pool.end();
    process.exit(1);
  });
