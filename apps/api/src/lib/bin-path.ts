import path from "node:path";

/**
 * Ruta de un binario hermano de otro (misma carpeta y extensión), p. ej.
 * `pg_restore` junto a `pg_dump`: así ambos son de la misma versión de PostgreSQL.
 * Si `ref` no tiene carpeta (está en el PATH), devuelve el nombre solo.
 */
export function siblingBinary(ref: string, name: string): string {
  const ext = /\.exe$/i.test(ref) ? ".exe" : "";
  const dir = path.dirname(ref);
  return dir === "." ? `${name}${ext}` : path.join(dir, `${name}${ext}`);
}
