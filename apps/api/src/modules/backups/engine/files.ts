import path from "node:path";
import { env } from "../../../config/env.js";

/** Raíz de fallback (variable BACKUP_DIR) para resolver rutas relativas heredadas. */
export const BACKUP_ROOT = path.resolve(process.cwd(), env.BACKUP_DIR);

/**
 * Resuelve la ruta absoluta de un archivo de backup local. Los registros nuevos
 * guardan ruta absoluta (se devuelve tal cual); los heredados guardaban una ruta
 * relativa a `BACKUP_DIR` (se resuelve contra él, con guarda anti-traversal).
 */
export function resolveBackupFile(stored: string): string {
  if (path.isAbsolute(stored)) return stored;
  const abs = path.resolve(BACKUP_ROOT, stored);
  if (abs !== BACKUP_ROOT && !abs.startsWith(BACKUP_ROOT + path.sep)) {
    throw new Error("Ruta de backup inválida");
  }
  return abs;
}
