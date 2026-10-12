import { databaseNameError } from "@dbkeeper/shared";

/**
 * Última barrera antes de lanzar pg_dump/mysqldump: también cubre eventos guardados
 * antes de validar en la API y reintentos de ejecuciones viejas (ver databaseNameError).
 */
export function assertSafeDbName(name: string): void {
  const err = databaseNameError(name);
  if (err) throw new Error(`${err}: ${JSON.stringify(name)}. Corrige el evento de backup.`);
}
