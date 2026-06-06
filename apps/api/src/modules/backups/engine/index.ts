import type { DbEngine } from "@dbkeeper/shared";
import type { Dumper } from "./types.js";
import { dumpPostgres } from "./postgres.js";
import { dumpMysql } from "./mysql.js";

/**
 * Dumpers por motor. PostgreSQL y MySQL implementados; Mongo y SQL Server se
 * añadirán después (mongodump, sqlcmd/BACKUP DATABASE).
 */
const DUMPERS: Partial<Record<DbEngine, Dumper>> = {
  postgres: dumpPostgres,
  mysql: dumpMysql,
};

/** Devuelve el dumper del motor o `null` si aún no está soportado. */
export function getDumper(engine: DbEngine): Dumper | null {
  return DUMPERS[engine] ?? null;
}

export type { DumpInput, DumpResult, Dumper } from "./types.js";
