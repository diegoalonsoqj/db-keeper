import type { DbEngine } from "@dbkeeper/shared";
import type { Dumper } from "./types.js";
import { dumpPostgres } from "./postgres.js";

/**
 * Dumpers por motor. La fase 2 solo implementa PostgreSQL; el resto se añadirá
 * en pasos siguientes (mysqldump, mongodump, sqlcmd/BACKUP DATABASE).
 */
const DUMPERS: Partial<Record<DbEngine, Dumper>> = {
  postgres: dumpPostgres,
};

/** Devuelve el dumper del motor o `null` si aún no está soportado. */
export function getDumper(engine: DbEngine): Dumper | null {
  return DUMPERS[engine] ?? null;
}

export type { DumpInput, DumpResult, Dumper } from "./types.js";
