import type { DbEngine } from "@dbkeeper/shared";
import type { Dumper } from "./types.js";
import { dumpPostgres } from "./postgres.js";
import { dumpMysql } from "./mysql.js";
import { dumpMongo } from "./mongo.js";

/**
 * Dumpers por motor. PostgreSQL, MySQL y MongoDB implementados; SQL Server se
 * añadirá después (`sqlcmd`/`BACKUP DATABASE`).
 */
const DUMPERS: Partial<Record<DbEngine, Dumper>> = {
  postgres: dumpPostgres,
  mysql: dumpMysql,
  mongo: dumpMongo,
};

/** Devuelve el dumper del motor o `null` si aún no está soportado. */
export function getDumper(engine: DbEngine): Dumper | null {
  return DUMPERS[engine] ?? null;
}

export type { DumpInput, DumpResult, Dumper } from "./types.js";
